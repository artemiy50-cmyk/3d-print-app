import time
import os
import re
from datetime import datetime, timedelta, timezone

# === НАСТРОЙКИ ===
FILE_PATH = 'script.js'
UTC_OFFSET = 3  

# ИСПРАВЛЕННЫЙ ПАТТЕРН (без синтаксической ошибки)
PATTERN = r'(console\.log\(["\']Version:\s*[^\s\(]+)\s*(?:\(.*?\))?(["\']\);)'

def get_time_str():
    # Получаем текущее время с учетом UTC+3
    now = datetime.now(timezone(timedelta(hours=UTC_OFFSET)))
    return now.strftime("%Y-%m-%d %H-%M-%S")

def update_version():
    try:
        with open(FILE_PATH, 'r', encoding='utf-8') as f:
            content = f.read()

        # Ищем строку
        if not re.search(PATTERN, content):
            print("⚠️ Строка Version не найдена.")
            return False

        new_ts = get_time_str()
        
        # Замена: \1 (версия) + новая дата + \2 (хвост)
        new_content = re.sub(PATTERN, rf'\1 ({new_ts})\2', content)

        if new_content != content:
            with open(FILE_PATH, 'w', encoding='utf-8') as f:
                f.write(new_content)
            print(f"🔥 [TIME UPDATED] {new_ts}")
            return True
    except Exception as e:
        print(f"❌ Ошибка: {e}")
    return False

def main():
    print(f"👀 Слежу за {FILE_PATH} (UTC+{UTC_OFFSET})")
    
    if not os.path.exists(FILE_PATH):
        print(f"❌ Файл {FILE_PATH} не найден!")
        return

    last_mtime = os.path.getmtime(FILE_PATH)

    while True:
        try:
            time.sleep(1)
            if not os.path.exists(FILE_PATH): continue
            
            current_mtime = os.path.getmtime(FILE_PATH)
            if current_mtime != last_mtime:
                time.sleep(0.1)
                if update_version():
                    last_mtime = os.path.getmtime(FILE_PATH)
                else:
                    last_mtime = current_mtime
        except KeyboardInterrupt:
            print("\n🛑 Остановка.")
            break

if __name__ == "__main__":
    main()
