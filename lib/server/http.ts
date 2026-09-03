export function json(data: unknown, status = 200, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('content-type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(data), {
    status,
    headers: responseHeaders,
  });
}

export function error(message: string, status = 400, details?: string[]) {
  return json({ error: message, details }, status);
}

export function parseJsonBody(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function stringField(body: Record<string, unknown>, key: string) {
  const value = body[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function isValidTimezone(value: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function safeSegment(value: string) {
  return (
    value
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 100) || 'arquivo'
  );
}

export function absoluteUrl(request: Request, path: string) {
  return new URL(path, request.url).toString();
}
