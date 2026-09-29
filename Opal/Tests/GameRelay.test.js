// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';
const Test = require('node:test');
const Assert = require('node:assert/strict');
const Dgram = require('node:dgram');
const { randomBytes: RandomBytes } = require('node:crypto');
const Relay = require('../Source/Net/VconlineRelay');

function Bind(Socket) {
    return new Promise((Resolve, Reject) => {
        Socket.once('error', Reject);
        Socket.bind(0, '127.0.0.1', () => {
            Socket.off('error', Reject);
            Resolve();
        });
    });
}
function Receive(Socket) {
    return new Promise((Resolve, Reject) => {
        const Timer = setTimeout(() => {
            Socket.off('message', Done);
            Reject(new Error('UDP delivery timed out'));
        }, 2000);
        function Done(Packet) {
            clearTimeout(Timer);
            Resolve(Packet);
        }
        Socket.once('message', Done);
    });
}

Test('real UDP sockets connect as distinct machines and exchange native directed traffic', async () => {
    const Server = Dgram.createSocket('udp4');
    const A = Dgram.createSocket('udp4'),
        B = Dgram.createSocket('udp4');
    const Errors = [];
    const Router = new Relay.Router((Packet, Peer) => Server.send(Packet, Peer.Port, Peer.Address));
    Server.on('message', (Packet, Peer) => {
        try {
            Router.Handle(Packet, Peer);
        } catch (Failure) {
            Errors.push(Failure);
        }
    });
    try {
        await Promise.all([Bind(Server), Bind(A), Bind(B)]);
        const Token = RandomBytes(16),
            Port = Server.address().port;
        for (const [Socket, Machine] of [
            [A, 0x68fan],
            [B, 0x79abn],
        ]) {
            const Packet = Buffer.alloc(28);
            Packet.writeUInt32BE(Relay.BuildHeader(0, 0, 28, 0));
            Token.copy(Packet, 4);
            Packet.writeBigUInt64BE(Machine, 20);
            const Reply = Receive(Socket);
            Socket.send(Packet, Port, '127.0.0.1');
            Assert.deepEqual(await Reply, Relay.BuildConnectReply(0, Machine));
        }
        for (const [From, To, Target] of [
            [A, B, 0x79abn],
            [B, A, 0x68fan],
        ]) {
            const Payload = RandomBytes(64),
                Packet = Buffer.alloc(16 + Payload.length);
            Packet.writeUInt32BE(Relay.BuildHeader(4, 1, Packet.length, 0));
            Packet.writeUInt32BE(1, 4);
            Packet.writeBigUInt64BE(Target, 8);
            Payload.copy(Packet, 16);
            const Reply = Receive(To);
            From.send(Packet, Port, '127.0.0.1');
            Assert.deepEqual(await Reply, Relay.BuildDelivery(4, 0, Payload));
        }
        Assert.deepEqual(Errors, []);
        Assert.equal(Router.Clients.size, 2);
    } finally {
        for (const Socket of [A, B, Server]) {
            try {
                Socket.close();
            } catch (_) {}
        }
    }
});
