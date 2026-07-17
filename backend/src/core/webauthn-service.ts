import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} from '@simplewebauthn/server';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  VerifiedAuthenticationResponse,
  VerifiedRegistrationResponse
} from '@simplewebauthn/server';

type StoredPasskey = {
  credentialID: string;
  publicKey: string;
  counter: number;
  transports?: AuthenticatorTransportFuture[];
};

type WebAuthnUser = {
  id: string;
  username: string;
  passkeys?: StoredPasskey[];
};

type WebAuthnRegisterOptionsArgs = {
  user: WebAuthnUser;
  rpID: string;
};

type WebAuthnVerifyRegisterArgs = {
  body: unknown;
  expectedChallenge: string;
  origin: string;
  rpID: string;
};

type WebAuthnLoginOptionsArgs = WebAuthnRegisterOptionsArgs;

type WebAuthnVerifyLoginArgs = WebAuthnVerifyRegisterArgs & {
  passkey: StoredPasskey;
};

/**
 * Generate registration options for WebAuthn.
 */
export async function getWebAuthnRegisterOptions({
  user,
  rpID
}: WebAuthnRegisterOptionsArgs): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const userPasskeys = user.passkeys || [];

  return generateRegistrationOptions({
    rpName: '36chan',
    rpID,
    userID: Buffer.from(user.id),
    userName: user.username,
    userDisplayName: user.username,
    attestationType: 'none',
    excludeCredentials: userPasskeys.map((passkey) => ({
      id: passkey.credentialID,
      type: 'public-key',
      transports: passkey.transports
    })),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required'
    }
  });
}

/**
 * Verify WebAuthn registration response.
 */
export async function verifyWebAuthnRegisterResponse({
  body,
  expectedChallenge,
  origin,
  rpID
}: WebAuthnVerifyRegisterArgs): Promise<VerifiedRegistrationResponse> {
  return verifyRegistrationResponse({
    response: body as RegistrationResponseJSON,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true
  });
}

/**
 * Generate authentication options for WebAuthn login.
 */
export async function getWebAuthnLoginOptions({
  rpID
}: WebAuthnLoginOptionsArgs): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return generateAuthenticationOptions({
    rpID,
    allowCredentials: [],
    userVerification: 'required'
  });
}

/**
 * Verify WebAuthn authentication response.
 */
export async function verifyWebAuthnLoginResponse({
  body,
  expectedChallenge,
  origin,
  rpID,
  passkey
}: WebAuthnVerifyLoginArgs): Promise<VerifiedAuthenticationResponse> {
  return verifyAuthenticationResponse({
    response: body as AuthenticationResponseJSON,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: passkey.credentialID,
      publicKey: Buffer.from(passkey.publicKey, 'base64url'),
      counter: passkey.counter,
      transports: passkey.transports
    },
    requireUserVerification: true
  });
}
