"""Password hashing (backend/src/shared/utils/hash.ts) - bcrypt, 10 rounds, compatible with the Node hashes."""
import bcrypt

SALT_ROUNDS = 10


def _bytes(password: str) -> bytes:
    # Node's bcrypt silently uses only the first 72 bytes; Python's bcrypt
    # raises instead. Truncate so both accept the same passwords.
    return password.encode('utf-8')[:72]


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_bytes(password), bcrypt.gensalt(SALT_ROUNDS)).decode('ascii')


def compare_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(_bytes(password), password_hash.encode('ascii'))
    except ValueError:
        return False
