// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Fs = require('fs');
const Path = require('path');
const Https = require('https');

const Log = require('../Core/Log');
const WebSocket = require('./Websocket');
const { Connection, Dispatch } = require('../Protocol/Connection');
const Position = require('../Protocol/Position');

const CertificateDirectory =
    process.env.OPAL_SSL || Path.resolve(__dirname, '..', '..', '..', 'Granite', 'Server', 'Storage', 'Certificate');
const DefaultKeyName = process.env.OPAL_KEY_NAME || (process.env.OPAL_SSL ? 'Bad.key' : 'Granite.key');
const DefaultCertificateName = process.env.OPAL_CERT_NAME || (process.env.OPAL_SSL ? 'Bad.crt' : 'Granite.crt');
const DefaultCertificate = {
    Key: Path.join(CertificateDirectory, DefaultKeyName),
    Certificate: Path.join(CertificateDirectory, DefaultCertificateName),
};

const Connections = new Map();

function IsExpectedTlsDisconnect(Failure) {
    return (
        !!Failure &&
        (Failure.code === 'ECONNRESET' ||
            Failure.code === 'ECONNABORTED' ||
            /^(socket hang up|Client network socket disconnected before secure TLS connection was established)$/i.test(
                String(Failure.message || ''),
            ))
    );
}

function LoadCertificate(Paths) {
    const Files = Paths || DefaultCertificate;
    if (!Fs.existsSync(Files.Key) || !Fs.existsSync(Files.Certificate)) {
        throw new Error(`certificate not found at ${Files.Key} and ${Files.Certificate}`);
    }
    return {
        key: Fs.readFileSync(Files.Key),
        cert: Fs.readFileSync(Files.Certificate),
        rejectUnauthorized: false,
    };
}

function Attach(Client) {
    const { Socket } = Client;
    Connections.set(Client.Id, Client);

    Socket.on('data', (Chunk) => {
        Client.Buffer = Buffer.concat([Client.Buffer, Chunk]);
        const Decoded = WebSocket.Decode(Client.Buffer);
        Client.Buffer = Decoded.Rest;

        if (Decoded.Oversized) {
            Client.Close('frame exceeded the maximum payload');
            return;
        }

        for (const Message of Decoded.Messages) {
            if (Message.Opcode === WebSocket.Opcode.Close) {
                Client.Close('client sent close');
                return;
            }
            if (Message.Opcode === WebSocket.Opcode.Ping) {
                Client.Socket.write(WebSocket.Encode(Message.Payload, WebSocket.Opcode.Pong));
                continue;
            }
            if (Message.Opcode !== WebSocket.Opcode.Binary) continue;

            try {
                Dispatch(Client, Message.Payload);
            } catch (E) {
                Log.Error(`dispatch failed for connection ${Client.Id}: ${E.message}`);
            }
        }
    });

    Socket.on('error', (E) => {
        if (E.code === 'ECONNRESET') {
            Client.PeerReset = true;
            Log.Info(`${Client.Identifier} reset its websocket @ ${Log.Clock()}`);
        } else {
            Log.Error(`connection ${Client.Id} socket error: ${E.message}`);
        }
    });

    Socket.on('close', () => {
        Connections.delete(Client.Id);
        Client.Close(Client.PeerReset ? 'peer reset the socket' : undefined);
    });
}

function Start({ port: Port = Number(process.env.OPAL_PORT) || 20054, Certificate = null } = {}) {
    const Server = Https.createServer(LoadCertificate(Certificate));

    Server.on('upgrade', (Req, Socket) => {
        const Key = Req.headers['sec-websocket-key'];
        if (!Req.headers.upgrade || !Key) {
            Socket.destroy();
            return;
        }
        Socket.write(WebSocket.HandshakeResponse(Key));
        Socket.setNoDelay(true);

        const Client = new Connection(Socket, Req, Port);
        Log.Verbose(`  connection ${Client.Id} upgraded from ` + `${Socket.remoteAddress}:${Socket.remotePort}`);
        Attach(Client);
    });

    Server.on('tlsClientError', (E) => {
        if (IsExpectedTlsDisconnect(E)) {
            Log.Verbose('TLS readiness probe disconnected before completing a handshake');
            return;
        }
        Log.Error(`tls handshake failed: ${E.message}`);
    });

    Server.on('error', (E) => {
        if (E.code === 'EADDRINUSE') {
            Log.Error(
                `port ${Port} is already in use. Opal defaults to 20054; ` +
                    `stop the other listener or set OPAL_PORT.`,
            );
        } else {
            Log.Error(`listener failed: ${E.message}`);
        }
        process.exitCode = 1;
    });

    Position.Start();

    Server.listen(Port, () => {
        Log.Info(`opal listening on wss://0.0.0.0:${Port} @ ${Log.Clock()}`);
    });

    return Server;
}

module.exports = {
    Start,
    Attach,
    Connections,
    LoadCertificate,
    DefaultCertificate,
    IsExpectedTlsDisconnect,
};
