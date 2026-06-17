import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} from '@simplewebauthn/server';

/**
 * Generate registration options for WebAuthn.
 */
export async function getWebAuthnRegisterOptions({ user, rpID }) {
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
}) {
  return verifyRegistrationResponse({
    response: body,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true
  });
}

/**
 * Generate authentication options for WebAuthn login.
 */
export async function getWebAuthnLoginOptions({ user, rpID }) {
  const userPasskeys = user.passkeys || [];

  return generateAuthenticationOptions({
    rpID,
    allowCredentials: userPasskeys.map((passkey) => ({
      id: passkey.credentialID,
      type: 'public-key',
      transports: passkey.transports
    })),
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
}) {
  return verifyAuthenticationResponse({
    response: body,
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
