// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Assert = require('assert');
const Crypto = require('crypto');
const Tls = require('tls');
const WebSocket = require('../Source/Net/Websocket');
const Listener = require('../Source/Net/Listener');
const { Connection, State, ReadConnect, OnConnect } = require('../Source/Protocol/Connection');
const Frame = require('../Source/Codec/Frame');
const FieldList = require('../Source/Codec/FieldList');
const { Crc } = require('../Source/Core/Names');
const Log = require('../Source/Core/Log');
const Samples = require('./Samples');

let Passed = 0,
    Pending = 0;
function Test(Name, Fn) {
    try {
        Fn();
        Passed++;
        process.stdout.write(`\x1b[38;5;39m  pass  ${Name}\x1b[0m\n`);
    } catch (E) {
        process.stdout.write(`\x1b[38;5;203m  FAIL  ${Name}\n        ${E.message}\x1b[0m\n`);
        process.exitCode = 1;
    }
}
function Async(Name, Fn) {
    Pending++;
    return Fn()
        .then(() => {
            Passed++;
            process.stdout.write(`\x1b[38;5;39m  pass  ${Name}\x1b[0m\n`);
        })
        .catch((E) => {
            process.stdout.write(`\x1b[38;5;203m  FAIL  ${Name}\n        ${E.message}\x1b[0m\n`);
            process.exitCode = 1;
        });
}

function MaskedFrame(Payload, Opcode = WebSocket.Opcode.Binary, Fin = true) {
    const Mask = Crypto.randomBytes(4);
    const Masked = Buffer.from(Payload);
    for (let I = 0; I < Masked.length; I++) Masked[I] ^= Mask[I & 3];

    let Header;
    if (Masked.length <= 125) {
        Header = Buffer.from([(Fin ? 0x80 : 0) | Opcode, 0x80 | Masked.length]);
    } else {
        Header = Buffer.alloc(4);
        Header[0] = (Fin ? 0x80 : 0) | Opcode;
        Header[1] = 0x80 | 126;
        Header.writeUInt16BE(Masked.length, 2);
    }
    return Buffer.concat([Header, Mask, Masked]);
}

Test('a masked client frame decodes back to its payload', () => {
    const Payload = Buffer.from('opal', 'utf8');
    const { Messages, Rest } = WebSocket.Decode(MaskedFrame(Payload));
    Assert.strictEqual(Messages.length, 1);
    Assert.deepStrictEqual(Messages[0].Payload, Payload);
    Assert.strictEqual(Rest.length, 0);
});

Test('a frame split across reads is held until it is complete', () => {
    const Whole = MaskedFrame(Buffer.alloc(200, 0xab));
    const First = WebSocket.Decode(Whole.slice(0, 40));
    Assert.strictEqual(First.Messages.length, 0, 'nothing yielded from a partial frame');

    const Joined = Buffer.concat([First.Rest, Whole.slice(40)]);
    const Second = WebSocket.Decode(Joined);
    Assert.strictEqual(Second.Messages.length, 1);
    Assert.strictEqual(Second.Messages[0].Payload.length, 200);
});

Test('continuation frames reassemble into one message', () => {
    const A = MaskedFrame(Buffer.from('half '), WebSocket.Opcode.Binary, false);
    const B = MaskedFrame(Buffer.from('a message'), WebSocket.Opcode.Continuation, true);
    const { Messages } = WebSocket.Decode(Buffer.concat([A, B]));
    Assert.strictEqual(Messages.length, 1);
    Assert.strictEqual(Messages[0].Payload.toString(), 'half a message');
});

Test('several frames in one read all come out', () => {
    const Bytes = Buffer.concat([
        MaskedFrame(Buffer.from('one')),
        MaskedFrame(Buffer.from('two')),
        MaskedFrame(Buffer.from('three')),
    ]);
    const { Messages } = WebSocket.Decode(Bytes);
    Assert.deepStrictEqual(
        Messages.map((M) => M.Payload.toString()),
        ['one', 'two', 'three'],
    );
});

Test('an oversized declared length is refused rather than allocated', () => {
    const Header = Buffer.alloc(10);
    Header[0] = 0x82;
    Header[1] = 127;
    Header.writeBigUInt64BE(BigInt(WebSocket.MaxPayload) * 8n, 2);
    const { Oversized } = WebSocket.Decode(Header);
    Assert.strictEqual(Oversized, true);
});

Test('server frames are never masked', () => {
    const Encoded = WebSocket.Encode(Buffer.from('abc'));
    Assert.strictEqual(Encoded[0], 0x82, 'fin plus binary');
    Assert.strictEqual(Encoded[1] & 0x80, 0, 'mask bit clear');
});

Test('the accept key matches the rfc example', () => {
    Assert.strictEqual(WebSocket.AcceptKey('dGhlIHNhbXBsZSBub25jZQ=='), 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
});

Test('the local plain-TCP readiness probe is not reported as a TLS failure', () => {
    Assert.strictEqual(Listener.IsExpectedTlsDisconnect({ code: 'ECONNRESET', message: 'socket hang up' }), true);
    Assert.strictEqual(Listener.IsExpectedTlsDisconnect({ message: 'socket hang up' }), true);
    Assert.strictEqual(
        Listener.IsExpectedTlsDisconnect({ code: 'ERR_SSL_WRONG_VERSION_NUMBER', message: 'wrong version number' }),
        false,
        'real TLS negotiation failures remain errors',
    );
});

Test('connect resolves identity, world and activity', () => {
    const Info = ReadConnect(Samples.AsStandalone(Samples.Connect));
    Assert.strictEqual(Info.WorldKey >>> 0, Crc('BOULEVARD'));
    Assert.strictEqual(Info.Puid, 0x0110000103b57f79n);
    Assert.strictEqual(Info.Derived, true, 'boulevard connect carries activity zero');
    Assert.strictEqual(Info.ActivityKey >>> 0, 0x3cf672c2);
});

Test('a change-server connection with activity zero derives it from the world key', () => {
    const Body = new FieldList.Builder().AddU32(0x4b7ad8c3, 0).AddU32('LOCATION', Crc('GAMBLING')).Build();
    const Bytes = Frame.Build(0x9d32c5b4, Buffer.alloc(8), Body, Frame.InnerHeader.None);
    const Info = ReadConnect(Bytes);
    Assert.strictEqual(Info.Derived, true);
    Assert.strictEqual(Info.ActivityKey >>> 0, 0xdb0b03f5, 'stage activity');
});

Test('a four-field connect-carrier status does not send a second init reply', () => {
    const Writes = [];
    const Client = new Connection({ destroyed: false, write: (B) => Writes.push(B) }, {});
    Client.State = State.Active;
    Client.Puid = 0x0110000100000666n;
    Client.ActivityKey = 0x3cf672c2;
    Client.WorldKey = Crc('BOULEVARD');

    const Body = new FieldList.Builder()
        .AddU64('MATCH_VERSION', 1001n)
        .AddBlob(0x247fa77f, Buffer.alloc(8))
        .AddU32(0x5bb78c48, 0x8b1a5bf5)
        .AddU64('MATCH_ID', 1000n)
        .Build();
    const Bytes = Frame.Build(0x9d32c5b4, Buffer.alloc(8), Body, Frame.InnerHeader.None);

    OnConnect(Client, Frame.Parse(Bytes), Bytes);
    Assert.strictEqual(Writes.length, 0, 'the status command is consumed without another init');
    Assert.strictEqual(Client.State, State.Active);
});

Test('objects are refused until the connection reaches state 2', () => {
    const Writes = [];
    const Socket = { destroyed: false, write: (B) => Writes.push(B) };
    const Client = new Connection(Socket, {});

    Assert.strictEqual(Client.State, State.Opening);
    Assert.strictEqual(Client.SendObject(Buffer.from('object')), false, 'opening must refuse objects');

    Client.Advance(State.Pending);
    Assert.strictEqual(
        Client.SendObject(Buffer.from('object')),
        false,
        'pending must refuse objects, exactly as SendObjectUpdate does',
    );

    Client.Advance(State.Active);
    Assert.strictEqual(Client.SendObject(Buffer.from('object')), true);
    Assert.strictEqual(Writes.length, 1, 'only the active send reached the socket');
});

Test('an identifier falls back to the connection number before a puid is known', () => {
    const Client = new Connection({ destroyed: false, write() {} }, {});
    Assert.match(Client.Identifier, /^connection \d+$/);
    Client.Puid = 0x0110000103b57f79n;
    Assert.strictEqual(Client.Identifier, '0110000103B57F79');
});

const Port = 21987;
Log.SetLevel(Log.Level.Error);

const Server = Listener.Start({ port: Port });

const Live = Async(
    'a real tls client upgrades and drives the state machine',
    () =>
        new Promise((Resolve, Reject) => {
            const Timer = setTimeout(() => Reject(new Error('timed out waiting for the handshake')), 8000);

            const Socket = Tls.connect({ port: Port, host: '127.0.0.1', rejectUnauthorized: false }, () => {
                const Key = Crypto.randomBytes(16).toString('base64');
                Socket.write(
                    [
                        'GET / HTTP/1.1',
                        'Host: 127.0.0.1',
                        'Upgrade: websocket',
                        'Connection: Upgrade',
                        'Sec-WebSocket-Key: ' + Key,
                        'Sec-WebSocket-Version: 13',
                        '',
                        '',
                    ].join('\r\n'),
                );
            });

            let Seen = Buffer.alloc(0);
            let Upgraded = false;

            Socket.on('data', (Chunk) => {
                Seen = Buffer.concat([Seen, Chunk]);
                if (Upgraded) return;
                const End = Seen.indexOf('\r\n\r\n');
                if (End < 0) return;

                const Head = Seen.slice(0, End).toString();
                try {
                    Assert.match(Head, /101 Switching Protocols/);
                    Assert.match(Head, /Sec-WebSocket-Accept:/i);
                } catch (E) {
                    clearTimeout(Timer);
                    Socket.destroy();
                    return Reject(E);
                }

                Upgraded = true;
                Seen = Seen.slice(End + 4);

                Socket.write(MaskedFrame(Samples.AsStandalone(Samples.Connect)));

                setTimeout(() => {
                    try {
                        const Connections = [...Listener.Connections.values()];
                        Assert.strictEqual(Connections.length, 1, 'one connection registered');
                        const Client = Connections[0];
                        Assert.strictEqual(Client.Puid, 0x0110000103b57f79n);
                        Assert.strictEqual(
                            Client.Activity,
                            'neighborhood',
                            'the world is boulevard; the activity served there is the neighborhood',
                        );
                        Assert.strictEqual(
                            Client.State,
                            State.Active,
                            'the init reply was sent, which is what flips the client node to state 2',
                        );
                        Assert.strictEqual(Client.ActivityName, 'neighborhood');
                        Assert.strictEqual(Client.SessionId, 1000n);
                        Assert.strictEqual(
                            Client.SendObject(Buffer.from('x')),
                            true,
                            'and objects are accepted once active',
                        );
                        clearTimeout(Timer);
                        Socket.destroy();
                        Resolve();
                    } catch (E) {
                        clearTimeout(Timer);
                        Socket.destroy();
                        Reject(E);
                    }
                }, 300);
            });

            Socket.on('error', (E) => {
                clearTimeout(Timer);
                Reject(E);
            });
        }),
);

Live.then(() => {
    Server.close();
    for (const C of Listener.Connections.values()) C.Close();
    process.stdout.write(`\n${Passed} passing\n`);
    setTimeout(() => process.exit(process.exitCode || 0), 50);
});
