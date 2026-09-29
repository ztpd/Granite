// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Crypto = require('node:crypto');
const Logger = require('../Core/Logger');
const { Crc32 } = require('../Core/Crc32');
const { GetString8 } = require('../Codec/FieldList');

const SupportedAlgs = Object.freeze({
    RS256: 'RSA-SHA256',
    RS384: 'RSA-SHA384',
    RS512: 'RSA-SHA512',
    ES256: 'SHA256',
    ES384: 'SHA384',
    ES512: 'SHA512',
});
const EcAlgs = new Set(['ES256', 'ES384', 'ES512']);

function B64urlToBuffer(Segment) {
    const Normalized = String(Segment).replace(/-/g, '+').replace(/_/g, '/');
    const Padded = Normalized + '='.repeat((4 - (Normalized.length % 4)) % 4);
    return Buffer.from(Padded, 'base64');
}

function DefaultDeriveAccountId(CelestialUserId) {
    const Digest = Crypto.createHash('sha256').update(`celestial:${CelestialUserId}`).digest();
    const Value = Digest.readBigUInt64BE(0) & 0x7fffffffffffffffn;
    return Value === 0n ? 1n : Value;
}

function CreateCelestialIdentity(Options = {}) {
    const PublicKeyPem = Options.PublicKeyPem || null;
    const SharedSecret = Options.SharedSecret || null;
    const Issuer = Options.Issuer || null;
    const Audience = Options.Audience || null;
    const ClockToleranceSec = Number.isFinite(Options.ClockToleranceSec) ? Options.ClockToleranceSec : 30;
    const HeaderName = (Options.TicketHeader || 'x-celestial-ticket').toLowerCase();
    const FieldCrc = Options.TicketFieldCrc || Crc32('CELESTIAL_TICKET');
    const DeriveAccountId = Options.DeriveAccountId || DefaultDeriveAccountId;
    const MaxReplayEntries = Options.MaxReplayEntries || 100000;
    const Now = Options.Now || (() => Math.floor(Date.now() / 1000));

    const SeenJti = new Map();

    function PurgeExpired(CurrentSec) {
        for (const [Jti, Exp] of SeenJti) {
            if (Exp <= CurrentSec) SeenJti.delete(Jti);
            else break;
        }
    }

    function ExtractToken(Input = {}) {
        const HeaderMap = Input.headers || {};
        const HeaderValue = HeaderMap[HeaderName];
        if (typeof HeaderValue === 'string' && HeaderValue.trim()) {
            return HeaderValue.trim().replace(/^Bearer\s+/i, '');
        }
        const Fields = Input.Parsed?.Fields || [];
        const FieldValue = GetString8(Fields, FieldCrc);
        if (typeof FieldValue === 'string' && FieldValue.trim()) return FieldValue.trim();
        return null;
    }

    function VerifyToken(Token) {
        const Parts = String(Token).split('.');
        if (Parts.length !== 3) throw new Error('ticket is not a compact JWS');
        const Header = JSON.parse(B64urlToBuffer(Parts[0]).toString('utf8'));
        const NodeAlg = SupportedAlgs[Header.alg];
        if (!NodeAlg && Header.alg !== 'HS256') throw new Error(`unsupported alg ${Header.alg}`);

        const SigningInput = Buffer.from(`${Parts[0]}.${Parts[1]}`, 'ascii');
        const Signature = B64urlToBuffer(Parts[2]);
        let Verified = false;
        if (Header.alg === 'HS256') {
            if (!SharedSecret) throw new Error('HS256 ticket verification is not configured');
            const Expected = Crypto.createHmac('sha256', SharedSecret).update(SigningInput).digest();
            Verified = Signature.length === Expected.length && Crypto.timingSafeEqual(Signature, Expected);
        } else {
            if (!PublicKeyPem) throw new Error(`${Header.alg} ticket verification is not configured`);
            const VerifyKey = EcAlgs.has(Header.alg) ? { key: PublicKeyPem, dsaEncoding: 'ieee-p1363' } : PublicKeyPem;
            Verified = Crypto.verify(NodeAlg, SigningInput, VerifyKey, Signature);
        }
        if (!Verified) {
            throw new Error('ticket signature did not verify');
        }

        const Claims = JSON.parse(B64urlToBuffer(Parts[1]).toString('utf8'));
        const CurrentSec = Now();
        if (typeof Claims.exp !== 'number' || Claims.exp + ClockToleranceSec < CurrentSec)
            throw new Error('ticket expired');
        if (typeof Claims.nbf === 'number' && Claims.nbf - ClockToleranceSec > CurrentSec)
            throw new Error('ticket not yet valid');
        if (Issuer && Claims.iss !== Issuer) throw new Error('ticket issuer mismatch');
        if (Audience) {
            const Aud = Array.isArray(Claims.aud) ? Claims.aud : [Claims.aud];
            if (!Aud.includes(Audience)) throw new Error('ticket audience mismatch');
        }
        if (!Claims.sub) throw new Error('ticket has no subject');
        if (!Claims.jti) throw new Error('ticket has no jti');

        PurgeExpired(CurrentSec);
        if (SeenJti.has(Claims.jti)) throw new Error('ticket replay detected');
        if (SeenJti.size >= MaxReplayEntries) {
            Logger.Error(`celestial replay guard is full (${MaxReplayEntries}); evicting oldest entry`);
            const Oldest = SeenJti.keys().next().value;
            if (Oldest !== undefined) SeenJti.delete(Oldest);
        }
        SeenJti.set(Claims.jti, Claims.exp);
        if (Claims.steamId !== undefined && !/^\d{15,20}$/.test(String(Claims.steamId))) {
            throw new Error('ticket has an invalid SteamID64');
        }
        return Claims;
    }

    return {
        Resolve(Input = {}) {
            if (!PublicKeyPem && !SharedSecret) return null;
            const Token = ExtractToken(Input);
            if (!Token) return null;
            try {
                const Claims = VerifyToken(Token);
                return {
                    verified: true,
                    accountId: Claims.steamId !== undefined ? BigInt(Claims.steamId) : DeriveAccountId(Claims.sub),
                    celestialUserId: String(Claims.sub),
                    Username: typeof Claims.name === 'string' ? Claims.name : null,
                    jti: String(Claims.jti),
                    ExpiresAt: Claims.exp,
                };
            } catch (Failure) {
                Logger.Verbose(`celestial ticket rejected: ${Failure.message}`);
                return null;
            }
        },
        SeenJti: SeenJti,
        VerifyToken: VerifyToken,
    };
}

module.exports = { CreateCelestialIdentity, DefaultDeriveAccountId, SupportedAlgs };
