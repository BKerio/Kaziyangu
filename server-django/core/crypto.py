"""
Secret encryption at rest (backend/src/shared/utils/crypto.ts) - AES-256-GCM
with a key derived from JWT_SECRET via scrypt. Same parameters and the same
base64(iv || authTag || ciphertext) layout, so values written by the Node
backend decrypt here and vice versa.
"""
import base64
import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .env import env

IV_BYTES = 12
TAG_BYTES = 16

# Node's crypto.scryptSync defaults: N=16384, r=8, p=1. A fixed,
# purpose-specific salt keeps this key distinct from JWT signing.
_KEY = hashlib.scrypt(env.JWT_SECRET.encode('utf-8'), salt=b'microsoft-oauth-token-v1', n=16384, r=8, p=1, dklen=32)


def encrypt_secret(plaintext: str) -> str:
    iv = os.urandom(IV_BYTES)
    sealed = AESGCM(_KEY).encrypt(iv, plaintext.encode('utf-8'), None)  # ciphertext || tag
    ciphertext, tag = sealed[:-TAG_BYTES], sealed[-TAG_BYTES:]
    return base64.b64encode(iv + tag + ciphertext).decode('ascii')


def decrypt_secret(payload: str) -> str:
    """Raises if the payload was tampered with or the key doesn't match."""
    raw = base64.b64decode(payload)
    iv, tag, ciphertext = raw[:IV_BYTES], raw[IV_BYTES:IV_BYTES + TAG_BYTES], raw[IV_BYTES + TAG_BYTES:]
    return AESGCM(_KEY).decrypt(iv, ciphertext + tag, None).decode('utf-8')
