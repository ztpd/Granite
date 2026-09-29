// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Log = require('../Core/Log');
const { Hex } = require('../Core/Crc32');
const Names = require('../Core/Names');
const Frame = require('../Codec/Frame');
const FieldList = require('../Codec/FieldList');
const Packets = require('./Packets');
const Worlds = require('./Worlds');
const WebSocket = require('../Net/Websocket');
const Activities = require('../Activity/Activities');
const Capture = require('../Net/Capture');
const ChangeServer = require('./ChangeServer');
const Roster = require('./Roster');
const Requests = require('./Requests');
const Userdata = require('./Userdata');
const PlayerObject = require('./PlayerObject');
const Position = require('./Position');
const WorldState = require('./WorldState');
const GotNext = require('./GotNext');
const Shootaround = require('./Shootaround');
const Squad = require('./Squad');
const Gambling = require('./Gambling');
const MyCourt = require('./MyCourt');

const State = {
    Opening: 0,
    Pending: 1,
    Active: 2,
    Closed: 3,
};

const StateNames = ['opening', 'pending', 'active', 'closed'];

const TracedFieldPackets = new Set([0xce148fb1, 0x9e3471ed]);

const CloseCode = { Normal: 1000, GoingAway: 1001 };

const LingerMs = 250;

let NextId = 0;

class Connection {
    constructor(Socket, Req, Port = Number(process.env.OPAL_PORT) || 20054) {
        this.Id = ++NextId;
        this.Port = Port;
        this.Socket = Socket;
        this.Request = Req;
        this.State = State.Opening;
        this.OpenedAt = Date.now();
        this.Buffer = Buffer.alloc(0);
        this.Seen = new Map();

        this.MachineId = Roster.MachineIdFor(this.Id);
        this.Userdata = null;
        this.PlayerBody = null;
        this.PlayerRevision = 0n;
        this.Position = null;
        this.PositionDirty = false;
        this.PositionAnnounced = false;
        this.KnownPlayers = new Set();
        this.PendingInvites = new Set();
        this.MyCourtBootstrapSent = false;
        this.MyCourtBootstrapTimer = null;

        this.Puid = null;
        this.TeamId = 0n;
        this.ClaimedPuid = null;
        this.ActivityKey = null;
        this.RoomScope = null;
        this.ActivityName = null;
        this.SessionId = null;
        this.WorldKey = null;
        this.Closed = false;
        this.AckTimer = null;
        this.CourtsPublished = false;
        this.CourtRefreshTimers = [];
        this.CourtsMoveRefreshed = false;
        this.CourtVersions = new Map();
        this.LastEchoMs = 0;
        this.GotNext = null;
    }

    get Identifier() {
        return this.Puid === null ? `connection ${this.Id}` : this.Puid.toString(16).toUpperCase().padStart(16, '0');
    }

    get Activity() {
        if (this.ActivityName) return this.ActivityName;
        return this.WorldKey === null ? 'unknown' : Worlds.Label(this.WorldKey);
    }

    Send(Payload) {
        if (this.Closed || this.Socket.destroyed) return false;
        try {
            this.Socket.write(WebSocket.Encode(Payload));
            Capture.RecordOutbound(this.Id, Payload);
            return true;
        } catch (E) {
            Log.Error(`connection ${this.Id} write failed: ${E.message}`);
            return false;
        }
    }

    SendObject(Payload) {
        if (this.State !== State.Active) {
            Log.Error(
                `object update for ${this.Identifier} skipped since connection is ` +
                    `not active, state is ${StateNames[this.State]}.`,
            );
            return false;
        }
        return this.Send(Payload);
    }

    Advance(Next) {
        if (this.State === Next) return;
        const From = StateNames[this.State];
        this.State = Next;
        Log.Verbose(`  connection ${this.Id} ${From} -> ${StateNames[Next]}`);
    }

    Farewell(Code = CloseCode.GoingAway) {
        const Socket = this.Socket;
        if (!Socket || Socket.destroyed) return;
        try {
            const Body = Buffer.alloc(2);
            Body.writeUInt16BE(Code, 0);
            Socket.write(WebSocket.Encode(Body, WebSocket.Opcode.Close));
            Socket.end();
            const Timer = setTimeout(() => {
                try {
                    Socket.destroy();
                } catch (_) {}
            }, LingerMs);
            if (Timer.unref) Timer.unref();
        } catch (_) {
            try {
                Socket.destroy();
            } catch (__) {}
        }
    }

    Close(Reason) {
        if (this.Closed) return;
        this.Closed = true;
        this.Advance(State.Closed);
        Requests.Stop(this);
        WorldState.CancelPending(this);
        if (Array.isArray(this.CourtRefreshTimers)) {
            for (const Timer of this.CourtRefreshTimers) clearTimeout(Timer);
            this.CourtRefreshTimers = [];
        }

        const Freed = GotNext.Vacate(this);
        if (Freed.length) {
            Log.Verbose(
                `  released ${Freed.length} got-next ` +
                    `${Freed.length === 1 ? 'seat' : 'seats'} held by ${this.Identifier}`,
            );
        }

        PlayerObject.PublishDestroy(this);
        Roster.Remove(this);
        Squad.Disconnect(this);
        const Activity = Activities.Lookup(this.ActivityKey, this.WorldKey);
        if (Activity) RefreshRosterForActivity(Activity, 'peer left', null, this.RoomScope || null);
        MyCourt.ClearConnection(this);
        this.Farewell();
        Log.Info(`${this.Identifier} disconnected${Reason ? ' — ' + Reason : ''} @ ${Log.Clock()}`);
        Summarise(this);
    }
}

const PuidPrefix = 0x01100001n;
const LooksLikePuid = (Value) => typeof Value === 'bigint' && Value >> 32n === PuidPrefix;

function ReadConnect(Bytes) {
    const List = FieldList.Parse(Bytes, Frame.HeaderSize);
    const Field = (Name) => FieldList.Find(List, Name);

    const Activity = Field(0x4b7ad8c3);
    const Location = Field('LOCATION');
    const WorldKey = Location ? Location.Data1 >>> 0 : null;
    const Team = Field('TEAM_ID');

    let ActivityKey = Activity ? Activity.Data1 >>> 0 : 0;
    let Derived = false;
    if (!ActivityKey && WorldKey !== null) {
        const Fallback = Worlds.ActivityFor(WorldKey);
        if (Fallback) {
            ActivityKey = Fallback;
            Derived = true;
        }
    }

    let Puid = null,
        Source = null,
        Unusual = null;
    for (const Name of ['PLAYER_PUID', 'PUID', 'USER_ID_LIST', 'MATCH_TYPE']) {
        const Found = Field(Name);
        const Value = Found && (Found.Value !== undefined ? Found.Value : BigInt(Found.Data1 >>> 0));
        if (!Value) continue;
        if (LooksLikePuid(Value)) {
            Puid = Value;
            Source = Name;
            Unusual = null;
            break;
        }
        if (!Puid) {
            Puid = Value;
            Source = Name;
            Unusual = Value;
        }
    }

    return {
        List: List,
        ActivityKey: ActivityKey || null,
        WorldKey: WorldKey,
        Puid: Puid,
        PuidSource: Source,
        Derived: Derived,
        Unusual: Unusual,
        TeamId: Team && Team.Value !== undefined ? Team.Value : 0n,
    };
}

function Dispatch(Client, Bytes) {
    Capture.Record(Client.Id, Bytes);

    const FrameData = Frame.Parse(Bytes);
    if (!FrameData) return;

    if (!Frame.IsWellFormed(FrameData)) {
        Log.Error(
            `${Packets.EngineName(FrameData.PacketId)} declared ${FrameData.Length} bytes ` +
                `but ${FrameData.Buffer.length} arrived, dropping.`,
        );
        return;
    }

    const Packet = Packets.Lookup(FrameData.PacketId);
    const First = !Client.Seen.has(FrameData.PacketId);
    let Handled = false;
    Client.Seen.set(FrameData.PacketId, (Client.Seen.get(FrameData.PacketId) || 0) + 1);

    if (First) Log.PacketReceived(Packets.EngineName(FrameData.PacketId));

    if (FrameData.PacketId === 0x9d32c5b4) {
        OnConnect(Client, FrameData, Bytes);
        return;
    }

    if (ChangeServer.IsTravelRequest(Bytes, FrameData.PacketId)) {
        OnTravelRequest(Client, FrameData, Bytes);
        Handled = true;
    }

    if (FrameData.PacketId === 0x9e3471ed) {
        Userdata.Relay(Client, Bytes);
        Handled = true;
    }

    if (FrameData.PacketId === PlayerObject.HandshakePacket) {
        PlayerObject.Register(Client, Bytes);
        if (MyCourt.PublishTemplate(Client)) Handled = true;
        Handled = true;
    }

    if (MyCourt.IsRoomPacket(FrameData.PacketId) && MyCourt.Relay(Client, Bytes, FrameData.PacketId)) {
        Handled = true;
    }

    if (FrameData.PacketId === Position.MovementPacket) {
        Position.Note(Client, Bytes);

        Position.Relay(Client, Bytes);
        Handled = true;
    }

    if (FrameData.PacketId === WorldState.Packet) {
        require('./PlayerObject').ApplyAppearanceUpdate(Client, Bytes);
        WorldState.Echo(Client, Bytes);
        Handled = true;
    }

    Handled = GotNext.Handle(Client, Bytes) || Handled;
    Handled = GotNext.HandleGameConnected(Client, Bytes) || Handled;
    Handled = GotNext.HandleGameEnd(Client, Bytes) || Handled;

    Handled = Shootaround.Handle(Client, Bytes) || Handled;

    Handled = Squad.Handle(Client, Bytes) || Handled;

    if (Packet && Packet.Body === Packets.Body.FieldList) {
        let Offset;
        if (Packet.Inner !== Frame.InnerHeader.None) {
            const Inner = Frame.ReadInnerHeader(Bytes, Packet.Inner);
            if (!Inner.Complete) {
                Log.Error(
                    `${Packets.EngineName(FrameData.PacketId)} inner header declares ` +
                        `${Inner.PayloadLength} bytes but only ${Inner.Available} arrived, ` +
                        `${Inner.Shortfall} missing.`,
                );
            }
            Offset = Inner.BodyOffset;
        } else {
            Offset = FieldList.Locate(Bytes);
        }

        if (Offset >= 0) {
            const List = FieldList.Parse(Bytes, Offset);
            if (List.Fields.length && (First || TracedFieldPackets.has(FrameData.PacketId >>> 0))) {
                Log.Verbose(`  ${List.Fields.length} fields at +${Offset}, ${FieldList.Format(List)}`);
            }
        }
    }

    if (First && !Handled) {
        Log.Verbose(
            `  no handler for ${Packets.EngineName(FrameData.PacketId)} yet, ` +
                `${FrameData.Length} bytes, counting from here`,
        );
    }
}

function OnTravelRequest(Client, FrameData, Bytes) {
    const Ask = ChangeServer.ReadRequest(Bytes);
    const WorldKey = Ask.WorldKey !== null ? Ask.WorldKey >>> 0 : null;

    if (WorldKey === null) {
        Log.Error(`${Client.Identifier} asked to travel but sent no world key, ` + `so there is nowhere to send them.`);
        return;
    }

    let Index;
    try {
        Index = Worlds.AssertRoutable(WorldKey);
    } catch (E) {
        Log.Error(`${Client.Identifier} asked for ${Worlds.Label(WorldKey)}: ${E.message}`);
        return;
    }

    const Destination = Activities.Lookup(Ask.Activity, WorldKey);
    if (!Destination) {
        Log.Error(`${Client.Identifier} asked for ${Worlds.Label(WorldKey)}, ` + `which opal has no activity for.`);
        return;
    }

    const Url = ChangeServer.UrlFor(Client.Socket, Client.Port);
    const SessionId = Ask.MatchType || Destination.SessionId;
    const ServerType = ChangeServer.ServerTypeFor(Ask);

    try {
        const Built = ChangeServer.Build({
            SessionId,
            ServerType,
            WorldKey,
            url: Url,
            ConnectionId: FrameData.Buffer.slice(8, 16),
        });
        Client.Send(Built.Frame);
        Log.Info(`${Client.Identifier} is travelling to ${Destination.Name} @ ${Log.Clock()}`);
        Log.Verbose(
            `  change server sent, ${Built.Frame.length} bytes, world ${Built.WorldName} ` +
                `at table index ${Index}, match ` +
                `${BigInt(SessionId).toString(16).toUpperCase()}, dial ${Url}`,
        );
    } catch (E) {
        Log.Error(`change server for ${Client.Identifier} could not be built: ${E.message}`);
    }
}

function Summarise(Client) {
    if (!Client.Seen.size) return;
    const Rows = [...Client.Seen.entries()]
        .sort((A, B) => B[1] - A[1])
        .map(([Id, N]) => `${Packets.EngineName(Id)} x${N}`);
    Log.Info(`connection ${Client.Id} received ${Rows.join(', ')}`);
    if (Client.CompressedCommands && Client.CompressedCommands.size) {
        const Inner = [...Client.CompressedCommands.entries()]
            .sort((A, B) => B[1] - A[1])
            .map(([Cmd, N]) => `${Names.Describe(Cmd)} x${N}`);
        Log.Info(`connection ${Client.Id} compressed commands: ${Inner.join(', ')}`);
    }
}

function EntriesWithUserdata(ActivityKey, RoomScope = undefined) {
    return Roster.EntriesFor(ActivityKey, null, RoomScope);
}

function RelayTokenFor(Client) {
    return Client && Client.RoomScope ? MyCourt.RelayTokenFor(Client) : null;
}

function RefreshRosterForActivity(Activity, Reason = 'roster changed', Exclude = null, RoomScope = undefined) {
    if (!Activity) return 0;
    const RosterData = EntriesWithUserdata(Activity.ActivityKey, RoomScope);
    const Recipients = Roster.InActivity(Activity.ActivityKey, RoomScope).filter(
        (Peer) => !Exclude || Peer.Id !== Exclude.Id,
    );
    let Sent = 0;
    for (const Peer of Recipients) {
        const Reply = Activities.BuildInit(Activity, RosterData, Peer.MachineId, RelayTokenFor(Peer));
        if (!Peer.Send(Reply)) continue;
        Sent++;
        Log.Verbose(
            `  roster snapshot ${Reason} -> ${Peer.Identifier}: ` +
                `${RosterData.length} users, ${RosterData.length} machines`,
        );
    }
    return Sent;
}

function RefreshRosterForPeers(Joiner, Activity, Reason = 'peer joined') {
    if (!Joiner || Joiner.Closed || Roster.Players.get(Joiner.Id) !== Joiner) return 0;
    const Sent = RefreshRosterForActivity(Activity, Reason, Joiner, Joiner.RoomScope || null);
    if (Sent) {
        const RosterData = Roster.EntriesFor(Joiner.ActivityKey, null, Joiner.RoomScope || null);
        Log.Verbose(
            `  refreshed the ${RosterData.length}-player roster for ${Sent} existing ` +
                `${Sent === 1 ? 'peer' : 'peers'} (${Reason}); paired VCONLINE ` +
                `user/machine data included`,
        );
    }
    return Sent;
}

function ScheduleRosterRefresh(Joiner, Activity) {
    return RefreshRosterForPeers(Joiner, Activity, 'peer joined');
}

function ScheduleCourtRefresh(Client, DelayMs) {
    const Timer = setTimeout(() => {
        if (Array.isArray(Client.CourtRefreshTimers)) {
            Client.CourtRefreshTimers = Client.CourtRefreshTimers.filter((T) => T !== Timer);
        }
        if (!Client.Closed) {
            try {
                require('./Courts').RepublishAll(Client);
            } catch (_) {}
        }
    }, DelayMs);
    if (Timer.unref) Timer.unref();
    if (!Array.isArray(Client.CourtRefreshTimers)) Client.CourtRefreshTimers = [];
    Client.CourtRefreshTimers.push(Timer);
    return Timer;
}

function OnConnect(Client, FrameData, Bytes) {
    let Info;
    try {
        Info = ReadConnect(Bytes);
    } catch (E) {
        Log.Error(`connect frame from connection ${Client.Id} could not be read: ${E.message}`);
        return;
    }

    Log.Verbose(`  ${Info.List.Fields.length} fields, ${FieldList.Format(Info.List)}`);

    const Status = FieldList.Find(Info.List, 0x5bb78c48);
    const HasRouting = Info.PuidSource !== null || Info.WorldKey !== null || Info.ActivityKey !== null;
    if (Client.State === State.Active && !HasRouting) {
        const Value = Status ? Status.Data1 >>> 0 : 0;
        Log.Verbose(
            `  connect-carrier status ${Hex(Value)} recorded; ` +
                `it is not a new connection, so no second init reply was sent`,
        );
        return;
    }

    const Repeat = Client.State === State.Active;
    if (Info.Puid && Client.ClaimedPuid === null) Client.ClaimedPuid = Info.Puid;
    if (Info.WorldKey !== null) Client.WorldKey = Info.WorldKey;
    if (Info.ActivityKey !== null) Client.ActivityKey = Info.ActivityKey;
    if (!Repeat) Client.Advance(State.Pending);

    if (Info.PuidSource) Log.Verbose(`  identity taken from ${Names.Describe(Names.Crc(Info.PuidSource))}`);
    if (Info.Unusual) {
        Log.Verbose(
            `  that identity does not carry 01100001 in its high half, so it is not a ` +
                `steam account id. Used anyway: it is what the client calls itself, in the ` +
                `Connect frame and in its handshake body, and two clients sharing one would ` +
                `be caught by the puid collision check.`,
        );
    }
    if (Info.Derived) {
        Log.Verbose(
            `  activity arrived as zero and was derived from world ` +
                `${Hex(Info.WorldKey)}, which a change-server connection always carries`,
        );
    }
    if (Repeat) Log.Verbose(`  repeat connect on an already active connection`);

    const ActivityKey = Info.ActivityKey !== null ? Info.ActivityKey : Client.ActivityKey;
    const WorldKey = Info.WorldKey !== null ? Info.WorldKey : Client.WorldKey;

    if (ActivityKey === null && WorldKey === null) {
        Log.Error(
            `${Client.Identifier} sent a connect with no activity and no world key, ` +
                `and none was remembered from an earlier one; nothing to route it to.`,
        );
        return;
    }

    const Activity = Activities.Lookup(ActivityKey, WorldKey);
    if (!Activity) {
        Log.Error(
            `${Client.Identifier} asked for activity ${Hex(ActivityKey)} ` +
                `in world ${Hex(WorldKey)}, which is not one opal serves.`,
        );
        return;
    }

    if (Info.Puid) {
        const Identity = Roster.AssignPuid(Client, Info.Puid, Activity.ActivityKey);
        if (Identity.Rewritten && Identity.Collision) {
            Log.Info(
                `connection ${Client.Id} claimed the live PUID used by connection ` +
                    `${Identity.Collision.Id}; publishing it as ` +
                    `${Identity.Puid.toString(16).toUpperCase().padStart(16, '0')} so both ` +
                    `players can exist in the park @ ${Log.Clock()}`,
            );
        }
    }
    Client.TeamId = Info.TeamId;
    if (Gambling.IsGambling({ WorldKey, ActivityKey })) {
        Log.Verbose(
            `  Ante-Up/GAMBLING entry accepted for world ${Hex(WorldKey)} ` +
                `and activity ${Hex(ActivityKey)}; court objects will be published`,
        );
    }
    Client.ActivityName = Activity.Name;
    Client.ActivityKey = Activity.ActivityKey !== null ? Activity.ActivityKey : Client.ActivityKey;
    Client.RoomScope = Activity.Name === 'mycourt' ? MyCourt.RoomScopeFor(Client) : null;
    Client.Advance(State.Active);
    Roster.Add(Client);

    const RosterData = EntriesWithUserdata(Client.ActivityKey, Client.RoomScope);
    const Reply = Activities.BuildInit(Activity, RosterData, Client.MachineId, RelayTokenFor(Client));
    if (!Client.Send(Reply)) {
        Log.Error(`init reply to ${Client.Identifier} could not be written.`);
        return;
    }
    Log.Verbose(
        `  VCONLINE roster sent: ${RosterData.length} users, ${RosterData.length} teams, ` +
            `${RosterData.length} machines, ${RosterData.length} user-data and machine-data elements`,
    );

    if (!Repeat) ScheduleRosterRefresh(Client, Activity);

    Client.SessionId = Activity.SessionId;

    Requests.Start(Client);

    if (Activity.Name === 'mycourt') {
        MyCourt.ScheduleBootstrap(Client);
        Log.Verbose(
            `  MyCourt ownership bootstrap scheduled; the client's later ` +
                `0x16A0D01E room request will be echoed authoritatively`,
        );
    } else if (require('./CourtData').IsBitstreamWorld(Activity.Name)) {
        const Published = require('./Courts').Publish(Client);
        if (Published > 0) {
            ScheduleCourtRefresh(Client, 4000);
            ScheduleCourtRefresh(Client, 20000);
        }
    } else {
        Log.Verbose(`  court and slot publication is disabled while park entry is stabilized`);
    }

    if (!Repeat) Log.PlayerEntered(Client.Identifier, Activity.Name);
    else Log.Info(`${Client.Identifier} re-announced in ${Activity.Name} @ ${Log.Clock()}`);
    Log.Verbose(
        `  init reply sent, ${Reply.length} bytes, ` +
            `MatchId is ${Hex(Number(Activity.SessionId))}, Result is Success, ` +
            `machine id ${Client.MachineId.toString(16)}, roster of ${RosterData.length}`,
    );

    if (!Repeat) MyCourt.ReplayTo(Client);
}

module.exports = {
    State,
    StateNames,
    CloseCode,
    LingerMs,
    Connection,
    ReadConnect,
    LooksLikePuid,
    Dispatch,
    OnConnect,
    OnTravelRequest,
    Summarise,
    EntriesWithUserdata,
    RefreshRosterForActivity,
    RefreshRosterForPeers,
    ScheduleRosterRefresh,
    ScheduleCourtRefresh,
    TracedFieldPackets,
};
