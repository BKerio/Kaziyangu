import { AppContext } from '../../context.js';
import { decryptSecret, encryptSecret } from '../../shared/utils/crypto.js';
import { MicrosoftOAuthService } from './microsoft-oauth.service.js';

/**
 * Owns the link between a User and their Microsoft account - the encrypted
 * refresh token saved once they complete "Login with Outlook" with
 * offline_access granted, and the on-demand exchange of that refresh token
 * for a short-lived access token whenever something needs to call Graph.
 * Access tokens are never persisted; only the (encrypted) refresh token is.
 */
export class MicrosoftAccountService {
  constructor(private app: AppContext, private oauth: MicrosoftOAuthService) {}

  async isConnected(userId: string): Promise<boolean> {
    const account = await this.app.prisma.microsoftAccount.findUnique({ where: { userId }, select: { id: true } });
    return account != null;
  }

  /** Upserts the link after a successful OAuth exchange. No-ops (logs) if Microsoft didn't return a refresh token. */
  async saveTokens(userId: string, tokens: { refreshToken: string | null; scope: string }): Promise<void> {
    if (!tokens.refreshToken) {
      this.app.log.warn({ userId }, 'Microsoft token exchange returned no refresh token - offline_access may not have been granted');
      return;
    }

    await this.app.prisma.microsoftAccount.upsert({
      where: { userId },
      create: { userId, refreshTokenEnc: encryptSecret(tokens.refreshToken), scope: tokens.scope },
      update: { refreshTokenEnc: encryptSecret(tokens.refreshToken), scope: tokens.scope },
    });
  }

  async disconnect(userId: string): Promise<void> {
    await this.app.prisma.microsoftAccount.deleteMany({ where: { userId } });
  }

  /**
   * Returns a fresh access token by spending the stored refresh token, or
   * null if the account isn't linked or the refresh token was revoked (in
   * which case the stale link is removed so the UI can prompt reconnecting).
   */
  async getValidAccessToken(userId: string): Promise<string | null> {
    const account = await this.app.prisma.microsoftAccount.findUnique({ where: { userId } });
    if (!account) return null;

    const refreshToken = decryptSecret(account.refreshTokenEnc);
    const tokens = await this.oauth.refreshAccessToken(refreshToken);
    if (!tokens) {
      // The refresh token is very likely revoked/expired - drop the dead
      // link rather than failing the same way on every future request.
      await this.app.prisma.microsoftAccount.delete({ where: { userId } }).catch(() => {});
      return null;
    }

    // Microsoft may rotate the refresh token; persist whatever we got back.
    await this.app.prisma.microsoftAccount.update({
      where: { userId },
      data: { refreshTokenEnc: encryptSecret(tokens.refreshToken ?? refreshToken), scope: tokens.scope },
    });

    return tokens.accessToken;
  }
}
