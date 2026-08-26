import { Logger } from '../../lib/logger.js';
import { EnvConfig } from '../../lib/env.js';
import { MicrosoftOAuthCredentials, requireMicrosoftAuthEnv } from './microsoft-oauth.config.js';

// openid+profile+email get us the id token claims; offline_access returns a
// refresh token so we can renew an access token without re-prompting the
// user; User.Read/Mail.Read/Calendars.Read let us call Graph's /me,
// /me/messages, and /me/events.
const SCOPES = ['openid', 'profile', 'email', 'offline_access', 'User.Read', 'Mail.Read', 'Calendars.Read'].join(' ');

export interface MicrosoftProfile {
  email: string;
  name: string;
}

export interface MicrosoftTokens {
  accessToken: string;
  /** Microsoft may or may not rotate the refresh token on each use - null means "keep the one you already have". */
  refreshToken: string | null;
  scope: string;
}

export interface MicrosoftCalendarEvent {
  id: string;
  subject: string;
  /** ISO 8601, UTC. */
  start: string;
  /** ISO 8601, UTC. */
  end: string;
  isAllDay: boolean;
  location: string | null;
  webLink: string;
}

/**
 * Thin wrapper over the Microsoft identity platform's OAuth2 authorization
 * code flow (v2.0 endpoint) plus the couple of Graph calls the app needs -
 * mirrors the style of whatsapp.client.ts.
 */
export class MicrosoftOAuthService {
  private readonly creds: MicrosoftOAuthCredentials;

  constructor(config: EnvConfig, private readonly log: Logger) {
    this.creds = requireMicrosoftAuthEnv(config);
  }

  private authBase(): string {
    return `https://login.microsoftonline.com/${this.creds.tenantId}/oauth2/v2.0`;
  }

  buildAuthorizationUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.creds.clientId,
      response_type: 'code',
      redirect_uri: this.creds.redirectUri,
      response_mode: 'query',
      scope: SCOPES,
      state,
    });
    return `${this.authBase()}/authorize?${params.toString()}`;
  }

  private async requestToken(grantParams: Record<string, string>): Promise<MicrosoftTokens | null> {
    try {
      const res = await fetch(`${this.authBase()}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.creds.clientId,
          client_secret: this.creds.clientSecret,
          scope: SCOPES,
          ...grantParams,
        }),
      });

      if (!res.ok) {
        this.log.error({ status: res.status, body: await res.text().catch(() => undefined) }, 'Microsoft token request failed');
        return null;
      }

      const data = (await res.json()) as { access_token: string; refresh_token?: string; scope?: string };
      return { accessToken: data.access_token, refreshToken: data.refresh_token ?? null, scope: data.scope ?? SCOPES };
    } catch (err) {
      this.log.error({ err }, 'Microsoft token request errored');
      return null;
    }
  }

  /** Exchanges an authorization code (from the callback redirect) for tokens. Returns null (and logs) on any failure. */
  exchangeCodeForTokens(code: string): Promise<MicrosoftTokens | null> {
    return this.requestToken({ grant_type: 'authorization_code', code, redirect_uri: this.creds.redirectUri });
  }

  /** Renews an access token from a previously stored refresh token. Returns null (and logs) on any failure. */
  refreshAccessToken(refreshToken: string): Promise<MicrosoftTokens | null> {
    return this.requestToken({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  /** Fetches the signed-in user's profile from Microsoft Graph. Returns null (and logs) on any failure. */
  async fetchProfile(accessToken: string): Promise<MicrosoftProfile | null> {
    try {
      const res = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) {
        this.log.error({ status: res.status }, 'Microsoft profile lookup failed');
        return null;
      }

      const data = (await res.json()) as { mail?: string; userPrincipalName?: string; displayName?: string };
      const email = data.mail || data.userPrincipalName;
      if (!email) return null;

      return { email, name: data.displayName || email };
    } catch (err) {
      this.log.error({ err }, 'Microsoft profile lookup errored');
      return null;
    }
  }

  /** Lists events on the signed-in user's calendar between two ISO 8601 instants. Returns null (and logs) on any failure. */
  async fetchCalendarEvents(accessToken: string, fromISO: string, toISO: string): Promise<MicrosoftCalendarEvent[] | null> {
    try {
      const params = new URLSearchParams({
        startDateTime: fromISO,
        endDateTime: toISO,
        $orderby: 'start/dateTime',
        $top: '50',
      });

      const res = await fetch(`https://graph.microsoft.com/v1.0/me/calendarView?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          // Normalizes start/end to UTC so we don't have to juggle each event's own timeZone field.
          Prefer: 'outlook.timezone="UTC"',
        },
      });

      if (!res.ok) {
        this.log.error({ status: res.status }, 'Microsoft calendar lookup failed');
        return null;
      }

      const data = (await res.json()) as {
        value: Array<{
          id: string;
          subject?: string;
          start: { dateTime: string };
          end: { dateTime: string };
          isAllDay: boolean;
          location?: { displayName?: string };
          webLink: string;
        }>;
      };

      return data.value.map((e) => ({
        id: e.id,
        subject: e.subject || '(No subject)',
        // Graph's "UTC" preference returns a naive local-looking timestamp with no offset - it's already UTC, just missing the "Z".
        start: `${e.start.dateTime}Z`,
        end: `${e.end.dateTime}Z`,
        isAllDay: e.isAllDay,
        location: e.location?.displayName || null,
        webLink: e.webLink,
      }));
    } catch (err) {
      this.log.error({ err }, 'Microsoft calendar lookup errored');
      return null;
    }
  }
}
