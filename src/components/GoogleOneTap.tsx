import { useEffect, useRef } from 'react';
import { useAuthStore } from '../store/authStore';

// Set this in your frontend .env (e.g. .env.local):
//   VITE_GOOGLE_CLIENT_ID=489419700744-5tuc2prdpsmpsa3fhpupjhhtb9ltp6r1.apps.googleusercontent.com
// This is the same OAuth client your redirect flow (AuthScreen) already
// uses -- One Tap and the redirect flow are just two different ways of
// authenticating against one client, not two separate integrations. The
// client ID is meant to be public (it's sent to the browser either way),
// so there's no secret to protect here.
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          prompt: () => void;
        };
      };
    };
  }
}

const SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve();

  const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
  if (existing) {
    return new Promise((resolve) => {
      existing.addEventListener('load', () => resolve(), { once: true });
    });
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Sign-In script'));
    document.head.appendChild(script);
  });
}

// Mounts Google's own One Tap prompt (the account-chooser card from your
// screenshot). Its appearance is entirely controlled by Google -- there is
// nothing here to style, position, or theme. Renders nothing itself
// (returns null); Google's script paints its own floating UI directly onto
// the page once initialized.
//
// Only mount this when you already know the visitor is signed out --
// LandingScreen does this by checking authStatus === 'unauthenticated'
// before rendering <GoogleOneTap />. Calling prompt() while already
// authenticated is both pointless and against Google's own UX guidance.
export function GoogleOneTap() {
  const loginWithGoogleCredential = useAuthStore((s) => s.loginWithGoogleCredential);
  const hasPrompted = useRef(false);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) {
      console.warn('GoogleOneTap: VITE_GOOGLE_CLIENT_ID is not set, skipping.');
      return;
    }
    if (hasPrompted.current) return;

    let cancelled = false;

    loadGoogleScript()
      .then(() => {
        if (cancelled || !window.google?.accounts?.id) return;

        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: async (response) => {
            // Sends the JWT to POST /api/auth/google/onetap for signature
            // verification -- see authStore.loginWithGoogleCredential.
            await loginWithGoogleCredential(response.credential);
          },
          // Don't auto-sign-in a returning user without a tap -- keeps
          // behavior predictable and matches what most sites do.
          auto_select: false,
          // Dismiss quietly if the user clicks elsewhere on the page,
          // rather than leaving the prompt sitting there.
          cancel_on_tap_outside: true,
        });

        window.google.accounts.id.prompt();
        hasPrompted.current = true;
      })
      .catch((err) => {
        console.error('GoogleOneTap failed to initialize:', err);
      });

    return () => {
      cancelled = true;
    };
  }, [loginWithGoogleCredential]);

  return null;
}