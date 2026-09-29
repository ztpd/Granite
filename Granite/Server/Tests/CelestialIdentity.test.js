// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Test = require('node:test');
const Assert = require('node:assert/strict');
const Crypto = require('node:crypto');
const Fs = require('node:fs');
const Os = require('node:os');
const Path = require('node:path');
const { Builder, Parse, GetU32, GetU64 } = require('../Source/Codec/FieldList');
const { Crc32 } = require('../Source/Core/Crc32');
const { SessionStore } = require('../Source/Storage/SessionStore');
const { CreateCelestialIdentity, DefaultDeriveAccountId } = require('../Source/Security/CelestialIdentity');
const Login = require('../Source/Services/Session/Login');

const EndpointFile = Path.resolve(__dirname, '../Storage/Session/Login/Endpoints2K19.json');
const TicketCrc = Crc32('CELESTIAL_TICKET');
const Issuer = 'https://celestial.test';
const Audience = 'park-1';

const { publicKey: PublicKey, privateKey: PrivateKey } = Crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PublicKeyPem = PublicKey.export({ type: 'spki', format: 'pem' }).toString();

function SignTicket(Payload, Header = { alg: 'RS256', typ: 'JWT' }) {
    const Enc = (Obj) => Buffer.from(JSON.stringify(Obj)).toString('base64url');
    const SigningInput = `${Enc(Header)}.${Enc(Payload)}`;
    const Sig = Crypto.sign('RSA-SHA256', Buffer.from(SigningInput, 'ascii'), PrivateKey).toString('base64url');
    return `${SigningInput}.${Sig}`;
}

function SignHmacTicket(Payload, Secret) {
    const Enc = (Obj) => Buffer.from(JSON.stringify(Obj)).toString('base64url');
    const SigningInput = `${Enc({ alg: 'HS256', typ: 'JWT' })}.${Enc(Payload)}`;
    const Signature = Crypto.createHmac('sha256', Secret).update(SigningInput).digest('base64url');
    return `${SigningInput}.${Signature}`;
}

function TicketFor(Sub, Extra = {}) {
    const NowSec = Math.floor(Date.now() / 1000);
    return SignTicket({
        iss: Issuer,
        aud: Audience,
        sub: Sub,
        jti: Crypto.randomUUID(),
        iat: NowSec,
        exp: NowSec + 90,
        ...Extra,
    });
}

function MakeResolver(Overrides = {}) {
    return CreateCelestialIdentity({ PublicKeyPem, Issuer: Issuer, Audience: Audience, ...Overrides });
}

function LoginRequest({
    platformUserId: PlatformUserId = 0x0110000100000666n,
    Username = 'SteamRIP',
    Ticket = null,
} = {}) {
    const ListBuilder = new Builder()
        .AddU64(Login.Crcs.UserId, PlatformUserId)
        .AddString8(Login.Crcs.GamertagLogin, Username)
        .AddU32(Login.Crcs.Environment, 0x8321fc23);
    if (Ticket) ListBuilder.AddString8(TicketCrc, Ticket);
    const Built = ListBuilder.Build();
    return { Body: Built.Body, Parsed: Parse(Built.Body) };
}

function TempSessions(T) {
    const Root = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'granite-identity-'));
    T.after(() => Fs.rmSync(Root, { recursive: true, force: true }));
    return new SessionStore(Root);
}

Test('a signed ticket keys the session on the Celestial account, USERNAME untouched', (T) => {
    const Sessions = TempSessions(T);
    const Identity = MakeResolver();
    const Input = LoginRequest({ Ticket: TicketFor('discord:12345', { name: 'RealPlayer' }) });
    Input.headers = {};
    const Reply = Login.Build(Input, { Sessions, EndpointFile, Identity });
    Assert.equal(GetU32(Parse(Reply.Body).Fields, Login.Crcs.Result), Login.Crcs.Success);

    const Stored = [...Sessions.Sessions.values()][0];
    Assert.equal(Stored.verified, true);
    Assert.equal(Stored.userId, DefaultDeriveAccountId('discord:12345').toString());
    Assert.equal(Stored.celestialUserId, 'discord:12345');
    Assert.equal(Stored.platformUserId, 0x0110000100000666n.toString());
    Assert.equal(Stored.gamertag, 'SteamRIP');
});

Test('the ticket may arrive as an HTTP header instead of a login field', (T) => {
    const Sessions = TempSessions(T);
    const Identity = MakeResolver();
    const Input = LoginRequest();
    Input.headers = { 'x-celestial-ticket': `Bearer ${TicketFor('discord:777')}` };
    Login.Build(Input, { Sessions, EndpointFile, Identity });
    const Stored = [...Sessions.Sessions.values()][0];
    Assert.equal(Stored.verified, true);
    Assert.equal(Stored.userId, DefaultDeriveAccountId('discord:777').toString());
});

Test('a local HS256 launch ticket makes its SteamID64 authoritative', (T) => {
    const Sessions = TempSessions(T);
    const SharedSecret = 'granite-local-ticket-secret-with-more-than-32-characters';
    const Identity = CreateCelestialIdentity({ SharedSecret, Issuer: Issuer, Audience: 'granite19' });
    const NowSec = Math.floor(Date.now() / 1000);
    const SteamId = '76561199301923421';
    const Ticket = SignHmacTicket(
        {
            iss: Issuer,
            aud: 'granite19',
            sub: Crypto.randomUUID(),
            jti: Crypto.randomUUID(),
            iat: NowSec,
            exp: NowSec + 90,
            steamId: SteamId,
            name: 'Steam Player',
        },
        SharedSecret,
    );
    const Input = LoginRequest();
    Input.headers = { 'x-celestial-ticket': Ticket };
    Login.Build(Input, { Sessions, EndpointFile, Identity, RequireVerifiedIdentity: true });
    const Stored = [...Sessions.Sessions.values()][0];
    Assert.equal(Stored.verified, true);
    Assert.equal(Stored.userId, SteamId);
});

Test('two different Celestial users get two different account ids from one shared emulator id', (T) => {
    const Sessions = TempSessions(T);
    const Identity = MakeResolver();
    for (const Sub of ['discord:aaa', 'discord:bbb']) {
        const Input = LoginRequest({ platformUserId: 0x0110000100000666n, Ticket: TicketFor(Sub) });
        Input.headers = {};
        Login.Build(Input, { Sessions, EndpointFile, Identity });
    }
    const Ids = [...Sessions.Sessions.values()].map((S) => S.userId);
    Assert.notEqual(Ids[0], Ids[1]);
});

Test('no ticket falls back to the client USERID and never marks the session verified', (T) => {
    const Sessions = TempSessions(T);
    const Identity = MakeResolver();
    const Input = LoginRequest();
    Input.headers = {};
    const Reply = Login.Build(Input, { Sessions, EndpointFile, Identity });
    Assert.equal(GetU32(Parse(Reply.Body).Fields, Login.Crcs.Result), Login.Crcs.Success);
    const Stored = [...Sessions.Sessions.values()][0];
    Assert.equal(Stored.verified, false);
    Assert.equal(Stored.userId, 0x0110000100000666n.toString());
});

Test('RequireVerifiedIdentity denies a login with no valid ticket', (T) => {
    const Sessions = TempSessions(T);
    const Identity = MakeResolver();
    const Input = LoginRequest();
    Input.headers = {};
    const Reply = Login.Build(Input, { Sessions, EndpointFile, Identity, RequireVerifiedIdentity: true });
    const Result = GetU32(Parse(Reply.Body).Fields, Login.Crcs.Result);
    Assert.notEqual(Result, Login.Crcs.Success);
    Assert.equal(Result, Login.Crcs.AccessDenied);
    Assert.equal(Sessions.Sessions.size, 0);
});

Test('a replayed jti is rejected the second time', (T) => {
    const Sessions = TempSessions(T);
    const Identity = MakeResolver();
    const Token = TicketFor('discord:replay');
    const First = LoginRequest({ Ticket: Token });
    First.headers = {};
    const Second = LoginRequest({ Ticket: Token });
    Second.headers = {};
    Assert.equal(Identity.Resolve(First)?.verified, true);
    Assert.equal(Identity.Resolve(Second), null);
});

Test('an expired ticket is rejected', () => {
    const Identity = MakeResolver();
    const NowSec = Math.floor(Date.now() / 1000);
    const Expired = SignTicket({
        iss: Issuer,
        aud: Audience,
        sub: 'discord:old',
        jti: Crypto.randomUUID(),
        exp: NowSec - 120,
    });
    Assert.equal(Identity.Resolve({ Parsed: Parse(LoginRequest({ Ticket: Expired }).Body) }), null);
});

Test('a wrong-audience ticket is rejected', () => {
    const Identity = MakeResolver();
    const Wrong = TicketFor('discord:x', { aud: 'some-other-server' });
    Assert.equal(Identity.Resolve({ Parsed: Parse(LoginRequest({ Ticket: Wrong }).Body) }), null);
});

Test('a ticket signed by a different key is rejected', () => {
    const Identity = MakeResolver();
    const Other = Crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const Enc = (Obj) => Buffer.from(JSON.stringify(Obj)).toString('base64url');
    const NowSec = Math.floor(Date.now() / 1000);
    const Si = `${Enc({ alg: 'RS256', typ: 'JWT' })}.${Enc({ iss: Issuer, aud: Audience, sub: 'discord:forged', jti: Crypto.randomUUID(), exp: NowSec + 90 })}`;
    const Forged = `${Si}.${Crypto.sign('RSA-SHA256', Buffer.from(Si), Other).toString('base64url')}`;
    Assert.equal(Identity.Resolve({ Parsed: Parse(LoginRequest({ Ticket: Forged }).Body) }), null);
});

Test('a verified session id is not rewritten by a later spoofable USERID (rebind trap)', (T) => {
    const Sessions = TempSessions(T);
    const Identity = MakeResolver();
    const Input = LoginRequest({ Ticket: TicketFor('discord:locked') });
    Input.headers = {};
    const Reply = Login.Build(Input, { Sessions, EndpointFile, Identity });
    const Key = GetU64(Parse(Reply.Body).Fields, Login.Crcs.SessionKey);
    const VerifiedId = DefaultDeriveAccountId('discord:locked');
    Assert.equal(Sessions.get(Key).userId, VerifiedId);

    Sessions.bind(Key, { userId: 0x0110000100000042n, gamertag: 'SteamRIP' });
    Assert.equal(Sessions.get(Key).userId, VerifiedId);
});

Test('with no key configured the resolver is disabled and login is unchanged', (T) => {
    const Sessions = TempSessions(T);
    const Identity = CreateCelestialIdentity({});
    const Input = LoginRequest({ Ticket: TicketFor('discord:ignored') });
    Input.headers = {};
    Login.Build(Input, { Sessions, EndpointFile, Identity });
    const Stored = [...Sessions.Sessions.values()][0];
    Assert.equal(Stored.verified, false);
    Assert.equal(Stored.userId, 0x0110000100000666n.toString());
});
