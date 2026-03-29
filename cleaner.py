"""
Сверка ссылок Cloudinary в Firebase RTDB с реальными ресурсами в Cloudinary,
опциональное «лечение» битых ссылок и удаление неиспользуемых файлов в облаке.

Учитывает: изделия (users/*/data/products) и ИМ — баннер, логотип, SEO og:image и товары витрины (users/*/store, storeProducts).
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any, Dict, Iterable, List, Optional, Tuple, Union

import cloudinary
import cloudinary.api
import firebase_admin
from firebase_admin import credentials, db

# === Настройки ===
CLOUDINARY_CLOUD_NAME = os.environ.get("CLOUDINARY_CLOUD_NAME", "dw4gdz64b")
CLOUDINARY_API_KEY = os.environ.get("CLOUDINARY_API_KEY")
CLOUDINARY_API_SECRET = os.environ.get("CLOUDINARY_API_SECRET")

FIREBASE_KEY_PATH = os.environ.get("FIREBASE_KEY_PATH", "firebase-key.json")
FIREBASE_DB_URL = os.environ.get(
    "FIREBASE_DB_URL",
    "https://d-print-app-3655b-default-rtdb.europe-west1.firebasedatabase.app",
)

# Обнулять в БД ссылки на файлы, которых уже нет в Cloudinary
FIX_BROKEN_LINKS = os.environ.get("FIX_BROKEN_LINKS", "true").lower() in (
    "1",
    "true",
    "yes",
)

# Удалять из Cloudinary ресурсы, не встречающиеся ни в одной «белой» ссылке
DELETE_ORPHAN_CLOUDINARY = os.environ.get("DELETE_ORPHAN_CLOUDINARY", "true").lower() in (
    "1",
    "true",
    "yes",
)


def _get_firebase_certificate():
    """Файл ключа или FIREBASE_SERVICE_ACCOUNT (без записи секрета на диск)."""
    if os.path.exists(FIREBASE_KEY_PATH):
        return credentials.Certificate(FIREBASE_KEY_PATH)
    key_content = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
    if not key_content:
        print(
            "Ошибка: нет файла "
            + FIREBASE_KEY_PATH
            + " и переменной FIREBASE_SERVICE_ACCOUNT",
            file=sys.stderr,
        )
        sys.exit(1)
    try:
        data = json.loads(key_content)
    except json.JSONDecodeError as e:
        print(
            "Ошибка: FIREBASE_SERVICE_ACCOUNT не является валидным JSON: " + str(e),
            file=sys.stderr,
        )
        sys.exit(1)
    if not isinstance(data, dict):
        print("Ошибка: JSON в FIREBASE_SERVICE_ACCOUNT должен быть объектом.", file=sys.stderr)
        sys.exit(1)
    return credentials.Certificate(data)


def _init_firebase() -> None:
    if not firebase_admin._apps:
        cred = _get_firebase_certificate()
        firebase_admin.initialize_app(cred, {"databaseURL": FIREBASE_DB_URL})


def _init_cloudinary() -> None:
    if not CLOUDINARY_API_KEY or not CLOUDINARY_API_SECRET:
        print(
            "Ошибка: задайте CLOUDINARY_API_KEY и CLOUDINARY_API_SECRET",
            file=sys.stderr,
        )
        sys.exit(1)
    cloudinary.config(
        cloud_name=CLOUDINARY_CLOUD_NAME,
        api_key=CLOUDINARY_API_KEY,
        api_secret=CLOUDINARY_API_SECRET,
        secure=True,
    )


def _is_cloudinary_url(url: Optional[str]) -> bool:
    return bool(url and isinstance(url, str) and "cloudinary.com" in url)


def _iter_indexed_children(
    node: Any,
) -> Iterable[Tuple[Union[int, str], Any]]:
    if isinstance(node, list):
        return enumerate(node)
    if isinstance(node, dict):
        return node.items()
    return []


def _register_url(url: Optional[str], active_urls: set, cloud_url_set: set) -> None:
    if not _is_cloudinary_url(url):
        return
    if url in cloud_url_set:
        active_urls.add(url)
    # http и https в списке ресурсов Cloudinary уже в cloud_url_set


def _collect_store_product_urls(
    sp: Dict[str, Any], active_urls: set, cloud_url_set: set
) -> None:
    _register_url(sp.get("imageUrl"), active_urls, cloud_url_set)
    urls = sp.get("imageUrls")
    if isinstance(urls, list):
        for u in urls:
            _register_url(u if isinstance(u, str) else None, active_urls, cloud_url_set)


def _fix_store_product(
    user_id: str,
    prod_key: Union[int, str],
    sp: Dict[str, Any],
    cloud_url_set: set,
) -> bool:
    changed = False
    img = sp.get("imageUrl")
    if img and _is_cloudinary_url(img) and img not in cloud_url_set:
        print(
            f"   🛠️ ЛЕЧЕНИЕ (ИМ товар): user={user_id} key={prod_key} -> imageUrl удалена"
        )
        sp["imageUrl"] = None
        changed = True

    urls = sp.get("imageUrls")
    if isinstance(urls, list):
        valid: List[Any] = []
        list_changed = False
        for u in urls:
            if isinstance(u, str) and _is_cloudinary_url(u) and u not in cloud_url_set:
                print(
                    f"   🛠️ ЛЕЧЕНИЕ (ИМ товар): user={user_id} key={prod_key} -> убрана ссылка в imageUrls"
                )
                list_changed = True
                continue
            valid.append(u)
        if list_changed:
            sp["imageUrls"] = valid
            changed = True
    return changed


def _fix_store_cloudinary_field(
    user_id: str,
    store: Dict[str, Any],
    field: str,
    label: str,
    cloud_url_set: set,
) -> bool:
    val = store.get(field)
    if not val or not isinstance(val, str) or not _is_cloudinary_url(val):
        return False
    if val in cloud_url_set:
        return False
    print(f"   🛠️ ЛЕЧЕНИЕ (ИМ {label}): user={user_id} -> {field} очищен")
    store[field] = None
    return True


def _process_app_products(
    user_id: str,
    data_node: Dict[str, Any],
    active_urls: set,
    cloud_url_set: set,
) -> int:
    fixed = 0
    products = data_node.get("products")
    for prod_key, p in _iter_indexed_children(products):
        if not p or not isinstance(p, dict):
            continue
        product_needs_update = False
        img = p.get("imageUrl")
        if img:
            if _is_cloudinary_url(img) and img not in cloud_url_set:
                print(
                    f"   🛠️ ЛЕЧЕНИЕ (Фото): '{p.get('name')}' -> Ссылка удалена."
                )
                p["imageUrl"] = None
                product_needs_update = True
            else:
                active_urls.add(img)

        files = p.get("fileUrls", [])
        valid_files = []
        files_changed = False
        if not isinstance(files, list):
            files = []

        for f in files:
            if not isinstance(f, dict):
                valid_files.append(f)
                continue
            f_url = f.get("url")
            if f_url:
                if _is_cloudinary_url(f_url) and f_url not in cloud_url_set:
                    print(
                        f"   🛠️ ЛЕЧЕНИЕ (Файл): '{p.get('name')}' -> Удален несуществующий '{f.get('name')}'"
                    )
                    files_changed = True
                else:
                    active_urls.add(f_url)
                    valid_files.append(f)
            else:
                valid_files.append(f)

        if files_changed:
            p["fileUrls"] = valid_files
            product_needs_update = True

        if product_needs_update and FIX_BROKEN_LINKS:
            product_ref_path = f"users/{user_id}/data/products/{prod_key}"
            updates: Dict[str, Any] = {}
            if p.get("imageUrl") is None:
                updates["imageUrl"] = None
            if files_changed:
                updates["fileUrls"] = valid_files
            db.reference(product_ref_path).update(updates)
            fixed += 1

        elif not product_needs_update:
            pass

    return fixed


def _process_store_for_user(
    user_id: str,
    user_data: Dict[str, Any],
    active_urls: set,
    cloud_url_set: set,
) -> int:
    fixed = 0
    store = user_data.get("store")
    if isinstance(store, dict):
        # banner, logo, seoOgImage (картинка для соцсетей / og:image в разделе SEO) — те же правила, что у товаров
        for field in ("banner", "logo", "seoOgImage"):
            val = store.get(field)
            _register_url(val if isinstance(val, str) else None, active_urls, cloud_url_set)
        if FIX_BROKEN_LINKS:
            upd: Dict[str, Any] = {}
            if _fix_store_cloudinary_field(
                user_id, store, "banner", "баннер", cloud_url_set
            ):
                upd["banner"] = store.get("banner")
            if _fix_store_cloudinary_field(
                user_id, store, "logo", "логотип", cloud_url_set
            ):
                upd["logo"] = store.get("logo")
            if _fix_store_cloudinary_field(
                user_id, store, "seoOgImage", "SEO og:image", cloud_url_set
            ):
                upd["seoOgImage"] = store.get("seoOgImage")
            if upd:
                db.reference(f"users/{user_id}/store").update(upd)
                fixed += 1

    raw_sp = user_data.get("storeProducts")
    for key, sp in _iter_indexed_children(raw_sp):
        if not sp or not isinstance(sp, dict):
            continue
        _collect_store_product_urls(sp, active_urls, cloud_url_set)
        if FIX_BROKEN_LINKS and _fix_store_product(user_id, key, sp, cloud_url_set):
            ref_path = f"users/{user_id}/storeProducts/{key}"
            upd: Dict[str, Any] = {}
            if "imageUrl" in sp:
                upd["imageUrl"] = sp.get("imageUrl")
            if "imageUrls" in sp:
                upd["imageUrls"] = sp.get("imageUrls")
            db.reference(ref_path).update(upd)
            fixed += 1

    return fixed


def run_cleanup() -> None:
    print("--- ЗАПУСК: ГЛУБОКАЯ ОЧИСТКА (изделия + ИМ) ---")
    _init_cloudinary()
    _init_firebase()

    print("1. Скачивание списка файлов из Cloudinary...")
    cloud_resources: List[Dict[str, Any]] = []
    next_cursor = None
    while True:
        res = cloudinary.api.resources(max_results=500, next_cursor=next_cursor)
        cloud_resources.extend(res["resources"])
        if "next_cursor" not in res:
            break
        next_cursor = res["next_cursor"]

    cloud_url_set = set()
    for res in cloud_resources:
        cloud_url_set.add(res["secure_url"])
        cloud_url_set.add(res["url"])

    print(f"   Файлов в облаке: {len(cloud_resources)}")

    print("2. Проверка и лечение базы данных...")
    users_ref = db.reference("users")
    users = users_ref.get()

    active_urls = set()
    fixed_count = 0

    if users and isinstance(users, dict):
        for user_id, user_data in users.items():
            if not isinstance(user_data, dict):
                continue
            data_node = user_data.get("data")
            if isinstance(data_node, dict):
                fixed_count += _process_app_products(
                    user_id, data_node, active_urls, cloud_url_set
                )
            fixed_count += _process_store_for_user(
                user_id, user_data, active_urls, cloud_url_set
            )

    print(f"   Активных ссылок в БД (учтены изделия и ИМ): {len(active_urls)}")
    print(f"   Операций записи в БД (лечение): {fixed_count}")

    files_to_delete = []
    for res in cloud_resources:
        if (res["secure_url"] not in active_urls) and (res["url"] not in active_urls):
            files_to_delete.append(res["public_id"])

    print(f"3. Кандидаты на удаление из облака: {len(files_to_delete)}")

    if not files_to_delete:
        print("   Облако чистое (или все ресурсы где-то учтены).")
        print("--- ЗАВЕРШЕНО ---")
        return

    if not DELETE_ORPHAN_CLOUDINARY:
        print("   Удаление отключено (DELETE_ORPHAN_CLOUDINARY=false).")
        print("--- ЗАВЕРШЕНО ---")
        return

    print("4. Удаление мусора из облака...")
    batch_size = 100
    for i in range(0, len(files_to_delete), batch_size):
        batch = files_to_delete[i : i + batch_size]
        cloudinary.api.delete_resources(batch)
        print(f"   Удалено {len(batch)} файлов...")

    print("--- ЗАВЕРШЕНО ---")


if __name__ == "__main__":
    run_cleanup()
