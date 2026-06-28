import { nanoid } from 'nanoid';

const DEVICE_ID_KEY = 'pdf-editor:device-id';

/**
 * Returns a stable anonymous ID for this browser, creating one on first
 * visit. This is the entire "identity" system — no accounts, no login.
 * It lives in localStorage, so clearing site data loses access to saved
 * documents (same tradeoff as a Sheets link with no account attached).
 */
export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = nanoid();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}
