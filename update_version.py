import sys
import os
import re
from datetime import datetime, timedelta, timezone

# === НАСТРОЙКИ ===
FILE_PATH = 'script.js'
UTC_OFFSET = 3  

PATTERN = r'(console\.log\(["\']Version:\s*[^\s\(]+)\s*(?:\(.*?\))?(["\']\);)'

def get_time_str():
    now = datetime.now(timezone(timedelta(hours=UTC_OFFSET)))
    return now.strftime("%Y-%m-%d %H-%M-%S")

def update_version():
    try:
        if not os.path.exists(FILE_PATH):
            return False

        with open(FILE_PATH, 'r', encoding='utf-8') as f:
            content = f.read()

        if not re.search(PATTERN, content):
            print("⚠️ [HOOK] Строка Version не найдена в script.js")
            return False

        new_ts = get_time_str()
        new_content = re.sub(PATTERN, rf'\1 ({new_ts})\2', content)

        if new_content != content:
            with open(FILE_PATH, 'w', encoding='utf-8') as f:
                f.write(new_content)
            print(f"🔥 [HOOK] Версия обновлена: {new_ts}")
            
            # ВАЖНО: Добавляем измененный файл обратно в индекс Git,
            # чтобы обновленная версия попала в ЭТОТ ЖЕ коммит
            os.system(f'git add {FILE_PATH}')
            return True
            
    except Exception as e:
        print(f"❌ [HOOK] Ошибка: {e}")
        return False

if __name__ == "__main__":
    update_version()
