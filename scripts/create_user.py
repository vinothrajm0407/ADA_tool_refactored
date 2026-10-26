"""Create (or reset) an app login in the database this backend uses (.env MSSQL_CONN_STR).

Accounts live in the database, not in Git, so a fresh clone with its own
database has no users, and signing up needs a verification email. This makes a
ready-to-use, already-verified account. Re-running for an existing email just
sets its password and marks it verified.

Usage (from the project folder):
    python scripts/create_user.py EMAIL PASSWORD [FIRST_NAME] [LAST_NAME]
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import bcrypt  # noqa: E402
from dotenv import load_dotenv  # noqa: E402

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from services import db  # noqa: E402


def main(argv):
    if len(argv) < 3:
        sys.exit(__doc__)
    email, password = argv[1].strip().lower(), argv[2]
    first = argv[3] if len(argv) > 3 else email.split("@")[0].capitalize()
    last = argv[4] if len(argv) > 4 else "-"
    if "@" not in email or len(password) < 8:
        sys.exit("Need a valid email and a password of at least 8 characters.")

    db.init_db()
    if not db.is_ready():
        sys.exit(f"Database not available: {db.init_error()}  (check MSSQL_CONN_STR in .env)")

    password_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    user = db.get_user_by_email(email)
    if user:
        db.reset_user_password(user["id"], password_hash)
        action = "existing user, password updated"
    else:
        user = db.create_user(first, last, email, password_hash)
        action = "user created"
    db.mark_email_verified(user["id"])
    print(f"{action}, email verified: {email}")


if __name__ == "__main__":
    main(sys.argv)
