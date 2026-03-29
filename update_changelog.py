# -*- coding: utf-8 -*-
"""
Объединённый скрипт: обновляет время в console.log и добавляет записи в CHANGELOG_ENTRIES.
- console.log: только время обновления (без номера версии)
- CHANGELOG_ENTRIES: вставляет последние N коммитов, версия = верхняя из текущего списка
- app-version.js: синхронизируется с этой же версией (админка и витрина читают одно число)
- Не выполняет git add — staging делается вручную
"""
import os
import re
import subprocess
from datetime import datetime, timedelta, timezone

SCRIPT_PATH = "script.js"
APP_VERSION_JS = "app-version.js"
UTC_OFFSET = 3
# Паттерн для console.log — заменим на вывод только времени
CONSOLE_LOG_PATTERN = re.compile(r"console\.log\([^;]+\);")
# Заголовок — любая строка, начинающаяся с "// === CHANGELOG"
CHANGELOG_HEADER = "// === CHANGELOG"
CHANGELOG_START = "const CHANGELOG_ENTRIES = ["
SEPARATOR = "    // === ниже список существовавших версий ===="


def get_first_changelog_version_from_content(content):
    """Верхняя версия из первой записи в CHANGELOG_ENTRIES (до разделителя)."""
    start = content.find(CHANGELOG_START)
    if start == -1:
        return None
    block_start = start + len(CHANGELOG_START)
    end = content.find("];", block_start)
    if end == -1:
        return None
    block = content[block_start:end]
    for line in block.split("\n"):
        stripped = line.strip()
        if not stripped or stripped.startswith("//"):
            continue
        m = re.search(r"version\s*:\s*['\"]([^'\"]+)['\"]", line)
        if m:
            return m.group(1).strip()
    return None


def read_app_version_file():
    """Читает window.APP_VERSION из app-version.js."""
    base = os.path.dirname(os.path.abspath(SCRIPT_PATH))
    path = os.path.join(base, APP_VERSION_JS)
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    m = re.search(r"window\.APP_VERSION\s*=\s*['\"]([^'\"]+)['\"]", text)
    return m.group(1).strip() if m else None


def write_app_version_file(version):
    """Записывает app-version.js (одна версия для админки и витрины)."""
    base = os.path.dirname(os.path.abspath(SCRIPT_PATH))
    path = os.path.join(base, APP_VERSION_JS)
    esc = (version or "").replace("\\", "\\\\").replace("'", "\\'")
    body = (
        "/** Одна версия для админки и витрины. Синхронизируется update_changelog.py с верхней строкой CHANGELOG. */\n"
        "window.APP_VERSION = '%s';\n" % esc
    )
    with open(path, "w", encoding="utf-8") as f:
        f.write(body)


def get_version_for_release(content):
    """Версия релиза: сначала верх CHANGELOG, иначе app-version.js, иначе запасной номер."""
    v = get_first_changelog_version_from_content(content)
    if v:
        return v
    v = read_app_version_file()
    if v:
        return v
    return "5.6.0"


def get_changelog_block_bounds(content):
    # Ищем любую строку // === CHANGELOG ... (варианты: "генерируется" / "пишется руками или генерируется")
    start = content.find(CHANGELOG_HEADER)
    if start == -1:
        return None, None, None
    end_marker = content.find("];", content.find(CHANGELOG_START, start))
    if end_marker == -1:
        return start, None, None
    end = end_marker + 2
    inner_start = content.find(CHANGELOG_START, start) + len(CHANGELOG_START)
    inner_end = content.find("];", inner_start)
    old_inner = content[inner_start:inner_end]
    return start, end, old_inner


def git_log_n(n):
    """Возвращает список (date_display, subject). Дата в формате dd.mm.yyyy."""
    if n <= 0:
        return []
    # Формат передаём отдельной строкой, чтобы % не терялись при передаче в git (особенно на Windows)
    fmt = "%ad\t%s"
    try:
        out = subprocess.check_output(
            ["git", "log", "-%d" % n, "--pretty=format:" + fmt, "--date=short"],
            cwd=os.path.dirname(os.path.abspath(SCRIPT_PATH)),
            encoding="utf-8",
            errors="replace",
        )
    except Exception as e:
        print("Ошибка git log: %s" % e)
        return []
    result = []
    for line in out.strip().split("\n"):
        if "\t" not in line:
            continue
        date_part, subject = line.split("\t", 1)
        date_part = date_part.strip()
        subject = subject.strip()
        # Пропускаем сырые плейсхолдеры (если git не подставил значения)
        if date_part in ("%ad", "") or subject in ("%s", ""):
            continue
        # YYYY-MM-DD -> dd.mm.yyyy
        if len(date_part) == 10 and date_part[4] == "-" and date_part[7] == "-":
            y, m, d = date_part.split("-")
            date_display = "%s.%s.%s" % (d, m, y)
        else:
            date_display = date_part
        result.append((date_display, subject))
    return result


def get_time_str():
    now = datetime.now(timezone(timedelta(hours=UTC_OFFSET)))
    return now.strftime("%Y-%m-%d %H-%M-%S")


def update_console_log_timestamp(content):
    """Заменяет console.log на вывод только времени обновления."""
    ts = get_time_str()
    new_line = "console.log('%s');" % ts
    if CONSOLE_LOG_PATTERN.search(content):
        return CONSOLE_LOG_PATTERN.sub(new_line, content, count=1)
    return content


def escape_js_string(s):
    s = (s or "").replace("\\", "\\\\").replace("'", "\\'").replace("\r", " ").replace("\n", " ")
    return s.strip()


def main():
    if not os.path.exists(SCRIPT_PATH):
        print("Файл script.js не найден.")
        return

    with open(SCRIPT_PATH, "r", encoding="utf-8") as f:
        content = f.read()

    content = update_console_log_timestamp(content)

    start_b, end_b, old_inner = get_changelog_block_bounds(content)
    if start_b is None or end_b is None:
        print("В script.js не найден блок CHANGELOG_ENTRIES.")
        return

    version = get_version_for_release(content)
    print("Версия релиза (changelog / app-version.js): %s" % version)

    try:
        n_str = input("Сколько последних коммитов вывести? (N, 0 — только обновить время): ").strip()
        n = int(n_str)
    except ValueError:
        print("Введите число.")
        return
    if n < 0:
        print("N не может быть отрицательным.")
        return

    if n == 0:
        with open(SCRIPT_PATH, "w", encoding="utf-8") as f:
            f.write(content)
        v = get_version_for_release(content)
        write_app_version_file(v)
        print("Обновлено время в console.log. app-version.js → %s" % v)
        return

    commits = git_log_n(n)
    if not commits:
        print("Коммиты не получены (проверьте, что вы в репозитории git).")
        return

    new_lines = []
    for date_display, subject in commits:
        desc = escape_js_string(subject)
        new_lines.append("    { version: '%s', dateDisplay: '%s', description: '%s' }," % (version, date_display, desc))

    new_block = (
        CHANGELOG_HEADER + "\n"
        + CHANGELOG_START + "\n"
        + "\n".join(new_lines) + "\n"
        + SEPARATOR + "\n"
        + old_inner.rstrip() + "\n"
        + "];"
    )

    new_content = content[:start_b] + new_block + content[end_b:]

    with open(SCRIPT_PATH, "w", encoding="utf-8") as f:
        f.write(new_content)

    write_app_version_file(version)
    print("Добавлено записей из коммитов: %d. Версия для всех: %s. app-version.js обновлён." % (len(commits), version))


if __name__ == "__main__":
    main()
