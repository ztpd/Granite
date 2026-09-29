// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Log = require('../Core/Log');
const { Hex } = require('../Core/Crc32');
const ChangeServer = require('./ChangeServer');
const Roster = require('./Roster');

const Enabled = process.env.OPAL_SPECTATOR_LOCKSTEP === '1';

const CourtType = (() => {
    const Raw = process.env.OPAL_SPECTATOR_COURT_TYPE;
    if (Raw === undefined || Raw === '') return null;
    const Value = Number(Raw);
    return Number.isInteger(Value) && Value >= 0 && Value <= 255 ? Value : null;
})();

function AlreadyToldKey(Game) {
    return Game && Game.MatchId !== undefined ? String(Game.MatchId) : null;
}

function Announce(Anchor, Game, Participants) {
    if (!Enabled || !Anchor || !Game) return 0;

    const Key = AlreadyToldKey(Game);
    if (!Key) return 0;
    Game.Spectators = Game.Spectators || new Set();
    Game.SpectatorsToldFor = Game.SpectatorsToldFor || Key;

    const Players = new Set(Participants || []);
    const Members = Roster.InActivity(Anchor.ActivityKey);

    const WorldKey = Anchor.WorldKey >>> 0;
    let ServerType;
    try {
        ServerType = ChangeServer.ServerTypeFor({ WorldKey: WorldKey });
    } catch (_) {
        ServerType = null;
    }

    let CourtFrame = null;
    if (CourtType !== null) {
        try {
            CourtFrame = require('./CourtData').BuildSpectatorCourtFrame(Game.Activity, Game.name, CourtType);
        } catch (Failure) {
            Log.Error(`spectator court override for ${Game.name} could not be built: ${Failure.message}`);
        }
    }

    let Sent = 0,
        Typed = 0;
    for (const Observer of Members) {
        if (Players.has(Observer) || Observer.Closed) continue;
        if (Observer.Puid !== null && Observer.Puid !== undefined && Game.Spectators.has(Observer.Puid)) continue;
        let Built;
        try {
            Built = ChangeServer.BuildSpectator({
                SessionId: Game.MatchId,
                ServerType,
                WorldKey,
                url: ChangeServer.UrlFor(Observer.Socket, Observer.Port),
            });
        } catch (Failure) {
            Log.Error(`spectator invite for ${Observer.Identifier} could not be built: ${Failure.message}`);
            continue;
        }
        if (CourtFrame && Observer.SendObject(CourtFrame)) Typed++;
        if (!Observer.Send(Built.Frame)) continue;
        if (Observer.Puid !== null && Observer.Puid !== undefined) Game.Spectators.add(Observer.Puid);
        Sent++;
    }

    if (Sent) {
        Log.Info(
            `spectator: invited ${Sent} sideline ` +
                `${Sent === 1 ? 'player' : 'players'} to watch match ${Hex(Number(Game.MatchId & 0xffffffffn))} ` +
                `on ${Game.name} @ ${Log.Clock()}` +
                (CourtType !== null ? ` (court type override ${CourtType} sent to ${Typed})` : ''),
        );
    }
    return Sent;
}

module.exports = { Enabled, CourtType, Announce };
