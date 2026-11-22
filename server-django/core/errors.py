"""
Application errors (backend/src/shared/errors/AppError.ts).

is_operational True  -> known, expected error (404, 403, 400, ...)
is_operational False -> unexpected programming bug (logged, still sent as-is)
"""


class AppError(Exception):
    def __init__(self, message: str, status_code: int, is_operational: bool = True) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.is_operational = is_operational


class NotFoundError(AppError):
    def __init__(self, resource: str = 'Resource') -> None:
        super().__init__(f'{resource} not found', 404)


class UnauthorizedError(AppError):
    def __init__(self, message: str = 'Authentication required') -> None:
        super().__init__(message, 401)


class ForbiddenError(AppError):
    def __init__(self, message: str = 'You do not have permission to perform this action') -> None:
        super().__init__(message, 403)


class BadRequestError(AppError):
    def __init__(self, message: str) -> None:
        super().__init__(message, 400)


class ConflictError(AppError):
    def __init__(self, message: str) -> None:
        super().__init__(message, 409)
