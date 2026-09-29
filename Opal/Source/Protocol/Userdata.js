// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Zlib = require('zlib');
const Log = require('../Core/Log');
const { Crc, Describe } = require('../Core/Names');
const FieldList = require('../Codec/FieldList');
const Frame = require('../Codec/Frame');
const Roster = require('./Roster');

const UserdataCommand = Crc('USERDATA');
const ReplayCommand = 0x29cf3374;
const GamePayloadField = 0x7d69940f;
const CompressedDataField = 0x970e50df;

function GamePeers(Connection) {
    if (
        !Connection ||
        !require('./CourtData').IsBitstreamWorld(Connection.ActivityName) ||
        !Connection.GotNext?.Playing ||
        Connection.GotNext.Court == null
    )
        return [];
    const GotNext = require('./GotNext');
    const Source = GotNext.GroupFor(Connection, Connection.GotNext.Court);
    if (!Source) return [];
    return Roster.Peers(Connection).filter((Peer) => {
        if (Peer.ActivityName !== Connection.ActivityName || !Peer.GotNext?.Playing || Peer.GotNext.Court == null)
            return false;
        const Target = GotNext.GroupFor(Peer, Peer.GotNext.Court);
        return Target && Target.CourtName === Source.CourtName;
    });
}

function ReadGamePayload(Bytes) {
    try {
        const Inner = Frame.ReadInnerHeader(Bytes, Frame.InnerHeader.Object);
        if (!Inner.Complete) return null;
        const List = FieldList.Parse(Bytes, Inner.BodyOffset);
        const Field = FieldList.Find(List, GamePayloadField);
        return Field ? FieldList.ReadBlob(List, Field) : null;
    } catch (_) {
        return null;
    }
}

function BuildGameDelivery(Command, RawPayload) {
    const Body = new FieldList.Builder()
        .AddBlob(CompressedDataField, Zlib.deflateSync(RawPayload, { level: 9 }))
        .AddU32('COMMAND', Command)
        .Build();
    return Frame.Build(0x9e3471ed, null, Body, Frame.InnerHeader.Object);
}

function RelayGameCommand(Connection, Bytes, Command, RawPayload = null) {
    const Peers = GamePeers(Connection);
    const Delivery = RawPayload ? BuildGameDelivery(Command, RawPayload) : Bytes;
    let Sent = 0;
    for (const Peer of Peers) if (Peer.SendObject(Delivery)) Sent++;
    const Count = Connection.CompressedCommands?.get(Command >>> 0) || 0;
    if (Count === 1 && Sent) {
        Log.Info(
            `${Connection.Identifier} started ${Describe(Command)} for ${Sent} ` +
                `${Sent === 1 ? 'peer' : 'peers'} on its active ${Connection.ActivityName} court @ ${Log.Clock()}`,
        );
    } else if (Sent && Count % 1000 === 0) {
        Log.Verbose(
            `  relayed ${Count} ${Describe(Command)} commands from ` +
                `${Connection.Identifier} to ${Sent} active-court peer(s)`,
        );
    }
    return Sent;
}

function Read(Bytes) {
    const Inner = Frame.ReadInnerHeader(Bytes, Frame.InnerHeader.Object);
    if (!Inner.Complete) return null;

    const List = FieldList.Parse(Bytes, Inner.BodyOffset);
    const Command = FieldList.Find(List, 'COMMAND');
    const BlobData = FieldList.Find(List, 'COMPRESSED_DATA');
    if (!Command || !BlobData) return null;

    return {
        Command: Command.Data1 >>> 0,
        IsUserdata: Command.Data1 >>> 0 === UserdataCommand,
        Blob: FieldList.ReadBlob(List, BlobData),
        DeclaredLength: BlobData.Data2,
    };
}

function DescribePayload(Payload) {
    if (!Payload || !Payload.Blob.length) return 'no blob';
    try {
        const Out = Zlib.inflateSync(Payload.Blob);
        return `${Payload.Blob.length} bytes compressed, ${Out.length} inflated`;
    } catch (E) {
        return `${Payload.Blob.length} bytes that would not inflate (${E.message})`;
    }
}

function Relay(Connection, Bytes) {
    const Payload = Read(Bytes);
    if (!Payload) {
        const Command = FieldList.Scan(Bytes, 'COMMAND');
        if (!Command) {
            Log.Error(`${Connection.Identifier} sent a compressed command that could not be read.`);
            return 0;
        }
        if (!Connection.CompressedCommands) Connection.CompressedCommands = new Map();
        const Key = Command.Data1 >>> 0;
        Connection.CompressedCommands.set(Key, (Connection.CompressedCommands.get(Key) || 0) + 1);
        const RawPayload = ReadGamePayload(Bytes);
        if (!RawPayload) {
            Log.Error(
                `${Connection.Identifier} sent ${Describe(Key)} without its ` +
                    `0x${GamePayloadField.toString(16).toUpperCase()} payload`,
            );
            return 0;
        }
        return RelayGameCommand(Connection, Bytes, Key, RawPayload);
    }

    if (!Connection.CompressedCommands) Connection.CompressedCommands = new Map();
    const InnerKey = Payload.Command >>> 0;
    Connection.CompressedCommands.set(InnerKey, (Connection.CompressedCommands.get(InnerKey) || 0) + 1);

    if (!Payload.IsUserdata) {
        return RelayGameCommand(Connection, Bytes, Payload.Command);
    }

    Connection.Userdata = Bytes;

    const Peers = Roster.Peers(Connection).filter((Peer) => Peer.KnownPlayers && Peer.KnownPlayers.has(Connection.Id));
    let Sent = 0;
    for (const Peer of Peers) {
        if (!Peer.SendObject(Bytes)) continue;
        Sent++;
        Log.Verbose(
            `  native receive carrier -> ${Peer.Identifier}: USERDATA for ` +
                `${Connection.Identifier}, PLAYER already known`,
        );
    }

    Log.Info(
        `${Connection.Identifier} shared userdata with ${Sent} ` +
            `${Sent === 1 ? 'player' : 'players'} in ${Connection.Activity} @ ${Log.Clock()}`,
    );
    Log.Verbose(`  ${DescribePayload(Payload)}, machine id ${Bytes.slice(8, 16).toString('hex')}`);
    PromoteVconlineProfile(Connection);
    if (
        require('./CourtData').IsBitstreamWorld(Connection.ActivityName) &&
        Connection.GotNext &&
        !Connection.GotNext.Playing
    )
        require('./GotNext').MaybeStartMatch(Connection);
    return Sent;
}

function ElementFor(Connection) {
    const FrameData = Connection && Connection.Userdata;
    if (!Buffer.isBuffer(FrameData) || FrameData.length < Frame.HeaderSize) return null;
    return Buffer.concat([FrameData.subarray(4, 8), FrameData.subarray(Frame.HeaderSize)]);
}

function ReplayTo(Connection) {
    let Sent = 0;
    for (const Peer of Roster.Peers(Connection)) {
        if (!Peer.Userdata) continue;
        if (!Connection.KnownPlayers || !Connection.KnownPlayers.has(Peer.Id)) continue;
        if (Connection.SendObject(Peer.Userdata)) Sent++;
    }
    if (Sent) {
        Log.Info(
            `${Connection.Identifier} was given the userdata of ${Sent} ` +
                `${Sent === 1 ? 'player' : 'players'} already in ${Connection.Activity} @ ${Log.Clock()}`,
        );
    }
    return Sent;
}

const RecordHeader = 0;
const PayloadLength = 223256;

const InflatedLength = PayloadLength;

function Packaged(Connection) {
    const Record = Inflated(Connection);
    if (!Record) return null;
    if (Record.length === PayloadLength) return Record;
    if (Record.length > PayloadLength) return Record.subarray(0, PayloadLength);
    Log.Error(
        `${Connection.Identifier} profile is ${Record.length}B, short of the ` +
            `${PayloadLength} PackageProvidedUserData writes — not sending an appearance`,
    );
    return null;
}

function GamertagFromInflated(Profile) {
    if (!Buffer.isBuffer(Profile) || Profile.length < 16) return '';
    let End = 12;
    const Limit = Math.min(Profile.length - 1, 12 + 128);
    while (End + 1 < Limit && Profile.readUInt16LE(End) !== 0) End += 2;
    if (End === 12 || End + 1 >= Limit) return '';
    const Value = Profile.subarray(12, End).toString('utf16le').trim();
    return /^[\x20-\x7E]{1,32}$/.test(Value) ? Value : '';
}

function Inflated(Connection) {
    if (!Connection || !Connection.Userdata) return null;
    if (Connection.UserdataInflated && Connection.UserdataInflatedFrom === Connection.Userdata) {
        return Connection.UserdataInflated;
    }
    const Payload = Read(Connection.Userdata);
    if (!Payload || !Payload.Blob.length) return null;
    let Out;
    try {
        Out = Zlib.inflateSync(Payload.Blob);
    } catch (E) {
        Log.Error(`${Connection.Identifier} userdata would not inflate: ${E.message}`);
        return null;
    }
    if (Out.length < PayloadLength) {
        Log.Verbose(
            `  ${Connection.Identifier} userdata inflated to ${Out.length} bytes, ` +
                `short of the ${PayloadLength} needed for a payload`,
        );
    }
    Connection.UserdataInflated = Out;
    Connection.UserdataInflatedFrom = Connection.Userdata;
    return Out;
}

function PromoteVconlineProfile(Connection) {
    const Profile = Packaged(Connection);
    if (!Profile) return false;

    const Gamertag = GamertagFromInflated(Profile);
    if (Gamertag) Connection.Gamertag = Gamertag;
    if (Connection.VconlineProfileReady) return false;
    Connection.VconlineProfileReady = true;

    const Activities = require('../Activity/Activities');
    const Activity = Activities.Lookup(Connection.ActivityKey, Connection.WorldKey);
    if (!Activity) return false;
    const { RefreshRosterForActivity } = require('./Connection');
    const Refreshed = RefreshRosterForActivity(Activity, 'userdata ready', null, Connection.RoomScope || null);
    Log.Verbose(
        `  VCONLINE profile ready for ${Connection.Identifier}` +
            `${Gamertag ? ` as "${Gamertag}"` : ''}; refreshed ${Refreshed} ` +
            `${Refreshed === 1 ? 'peer' : 'peers'}`,
    );
    return true;
}

module.exports = {
    UserdataCommand,
    ReplayCommand,
    GamePayloadField,
    CompressedDataField,
    Read,
    ReadGamePayload,
    BuildGameDelivery,
    Relay,
    ReplayTo,
    ElementFor,
    GamePeers,
    RelayGameCommand,
    Inflated,
    Packaged,
    InflatedLength,
    RecordHeader,
    PayloadLength,
    GamertagFromInflated,
    PromoteVconlineProfile,
    Describe: DescribePayload,
};
