export function isGuidedRoute(path: string): boolean {
  const pathname = path.split('?')[0];
  return pathname?.startsWith('/api/voice/') === true || pathname === '/ride/join';
}

export function guidedError(status: number, message: string): { error: { code: string; message: string } } {
  const code = status === 400 ? 'invalid_request'
    : status === 401 ? 'unauthorized'
      : status === 409 ? 'context_mismatch'
        : status === 410 ? 'reference_expired'
          : status === 413 ? 'body_too_large'
            : status === 415 ? 'unsupported_media_type'
              : status === 502 ? 'provider_failure'
                : status === 503 ? 'configuration_unavailable'
                  : 'request_failed';
  const translated = message === 'Request body must be valid JSON.'
    ? 'Der Request-Body muss gültiges JSON sein.'
    : message === 'Request validation failed.'
      ? 'Der Request-Body ist ungültig.'
      : status === 401
        ? 'Authentifizierung ist erforderlich.'
        : status === 413
          ? 'Der JSON-Body ist zu groß (maximal 16 KiB).'
          : status === 415
            ? 'Content-Type application/json ist erforderlich.'
            : status === 502
              ? 'Ein benötigter Anbieter hat die Anfrage nicht erfolgreich verarbeitet.'
              : status === 503
                ? 'Eine benötigte Integration ist derzeit nicht verfügbar.'
                : message;
  return { error: { code, message: translated } };
}
