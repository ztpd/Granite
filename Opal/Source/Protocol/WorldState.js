// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Log = require('../Core/Log');
const ObjectFrame = require('../Codec/ObjectFrame');
const PlayerObject = require('./PlayerObject');

const Packet = 0xfef2dd68;

const KeyOffset = ObjectFrame.Layout.Player.Payload + ObjectFrame.Body.Key;
const VersionOffset = ObjectFrame.Layout.Player.Payload + ObjectFrame.Body.Version;

const VersionStep = 16n;

const MinIntervalMs = 250;

function Build(Bytes) {
    if (Bytes.length < VersionOffset + 8) return { Frame: Bytes, From: null, To: null, Key: null };
    const Frame = Buffer.from(Bytes);
    const Key = Frame.readBigUInt64BE(KeyOffset);
    const From = Frame.readBigUInt64BE(VersionOffset);
    const To = From + VersionStep;
    Frame.writeBigUInt64BE(To, VersionOffset);
    return { Frame: Frame, From: From, To: To, Key: Key };
}

function Mine(Connection, Key) {
    return Key !== null && Connection.Puid !== null && Key === Connection.Puid;
}

function Echo(Connection, Bytes) {
    if (!Connection.PlayerBody) return false;

    const { From, Key } = Build(Bytes);
    if (!Mine(Connection, Key)) return false;

    if (From !== null && From >= Connection.PlayerRevision) Connection.PlayerRevision = From;

    const Now = Date.now();
    if (Connection.LastEchoMs && Now - Connection.LastEchoMs < MinIntervalMs) {
        if (!Connection.PendingEchoTimer) {
            const Timer = setTimeout(
                () => {
                    Connection.PendingEchoTimer = null;
                    if (Connection.Closed) return;
                    Reply(Connection, From, 'deferred ');
                },
                MinIntervalMs - (Now - Connection.LastEchoMs),
            );
            if (Timer.unref) Timer.unref();
            Connection.PendingEchoTimer = Timer;
        }
        Log.Verbose(
            `  player object reply to ${Connection.Identifier} deferred by the rate limit, ` +
                `${Now - Connection.LastEchoMs}ms since the last one`,
        );
        return false;
    }
    return Reply(Connection, From, '');
}

function CancelPending(Connection) {
    if (Connection && Connection.PendingEchoTimer) {
        clearTimeout(Connection.PendingEchoTimer);
        Connection.PendingEchoTimer = null;
    }
}

function Reply(Connection, From, Kind) {
    CancelPending(Connection);
    Connection.LastEchoMs = Date.now();

    const Frame = PlayerObject.FrameFor(Connection);
    if (!Frame || !Connection.SendObject(Frame)) {
        Log.Error(`player object reply to ${Connection.Identifier} could not be written.`);
        return false;
    }

    Log.Verbose(
        `  ${Kind}answered ${Connection.Identifier}'s object update ` +
            `(version ${From === null ? '?' : From}) with their player object at revision ` +
            `${Connection.PlayerRevision}, which is what resolves the pending request`,
    );
    return true;
}

module.exports = {
    Packet,
    KeyOffset,
    VersionOffset,
    VersionStep,
    MinIntervalMs,
    Mine,
    Build,
    Echo,
    CancelPending,
};
