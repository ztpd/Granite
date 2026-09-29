// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Crypto = require('crypto');

const Opcode = {
    Continuation: 0x0,
    Text: 0x1,
    Binary: 0x2,
    Close: 0x8,
    Ping: 0x9,
    Pong: 0xa,
};

const GuidRfc6455 = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MaxPayload = 16 * 1024 * 1024;

function AcceptKey(ClientKey) {
    return Crypto.createHash('sha1')
        .update(ClientKey + GuidRfc6455)
        .digest('base64');
}

function HandshakeResponse(ClientKey) {
    return [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        'Sec-WebSocket-Accept: ' + AcceptKey(ClientKey),
        'Sec-WebSocket-Protocol: chat',
        '',
        '',
    ].join('\r\n');
}

function Encode(Payload, OpcodeValue = Opcode.Binary) {
    const Length = Payload.length;
    let Header;
    if (Length <= 125) {
        Header = Buffer.from([0x80 | OpcodeValue, Length]);
    } else if (Length <= 0xffff) {
        Header = Buffer.alloc(4);
        Header[0] = 0x80 | OpcodeValue;
        Header[1] = 126;
        Header.writeUInt16BE(Length, 2);
    } else {
        Header = Buffer.alloc(10);
        Header[0] = 0x80 | OpcodeValue;
        Header[1] = 127;
        Header.writeBigUInt64BE(BigInt(Length), 2);
    }
    return Buffer.concat([Header, Payload]);
}

function Decode(Bytes) {
    const Messages = [];
    let Offset = 0;
    let FragmentOpcode = null;
    let Fragments = [];

    while (true) {
        if (Bytes.length - Offset < 2) break;

        const First = Bytes[Offset];
        const Second = Bytes[Offset + 1];
        const Fin = (First & 0x80) !== 0;
        const OpcodeValue = First & 0x0f;
        const Masked = (Second & 0x80) !== 0;

        let Length = Second & 0x7f;
        let Cursor = Offset + 2;

        if (Length === 126) {
            if (Bytes.length - Cursor < 2) break;
            Length = Bytes.readUInt16BE(Cursor);
            Cursor += 2;
        } else if (Length === 127) {
            if (Bytes.length - Cursor < 8) break;
            const Wide = Bytes.readBigUInt64BE(Cursor);
            if (Wide > BigInt(MaxPayload)) {
                return { Messages: Messages, Rest: Bytes.slice(Offset), Oversized: true };
            }
            Length = Number(Wide);
            Cursor += 8;
        }

        if (Length > MaxPayload) {
            return { Messages: Messages, Rest: Bytes.slice(Offset), Oversized: true };
        }

        const MaskOffset = Cursor;
        if (Masked) Cursor += 4;
        const End = Cursor + Length;
        if (Bytes.length < End) break;

        const Payload = Buffer.allocUnsafe(Length);
        Bytes.copy(Payload, 0, Cursor, End);
        if (Masked) {
            const Mask = Bytes.slice(MaskOffset, MaskOffset + 4);
            for (let I = 0; I < Length; I++) Payload[I] ^= Mask[I & 3];
        }

        if (OpcodeValue === Opcode.Continuation) {
            Fragments.push(Payload);
            if (Fin) {
                Messages.push({ Opcode: FragmentOpcode, Payload: Buffer.concat(Fragments) });
                FragmentOpcode = null;
                Fragments = [];
            }
        } else if (!Fin) {
            FragmentOpcode = OpcodeValue;
            Fragments = [Payload];
        } else {
            Messages.push({ Opcode: OpcodeValue, Payload: Payload });
        }

        Offset = End;
    }

    return { Messages: Messages, Rest: Bytes.slice(Offset), Oversized: false };
}

module.exports = { Opcode, MaxPayload, AcceptKey, HandshakeResponse, Encode, Decode };
