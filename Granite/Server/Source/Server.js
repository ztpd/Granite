// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

'use strict';

const Fs = require('node:fs');
const Https = require('node:https');
const Path = require('node:path');
const Logger = require('./Core/Logger');
const Names = require('./Core/Names');
const Capture = require('./Core/Capture');
const { Builder, TryParse, GetU64, GetString8 } = require('./Codec/FieldList');
const { Generate } = require('./Net/Certificate');
const { ContentStore } = require('./Storage/ContentStore');
const { SessionStore } = require('./Storage/SessionStore');
const { LoadOwnedItems, SaveOwnedItems } = require('./Storage/OwnedItems');
const { LoadAutomaticItems } = require('./Storage/AutomaticOwnership');
const { LoadCatalogPrices } = require('./Storage/StoreCatalog');
const { LoadCareerOveralls, SaveCareerOveralls, RecordOverall } = require('./Storage/CareerOverall');
const { LoadCareerGrind, SaveCareerGrind } = require('./Storage/CareerGrind');
const { CareerKey } = require('./Services/MyCareer/Attributes/Constants');
const { CreateCelestialIdentity } = require('./Security/CelestialIdentity');
const Login = require('./Services/Session/Login');
const SessionUpdate = require('./Services/Session/Update');
const Acknowledge = require('./Services/Common/Acknowledge');
const UserFields = require('./Services/UserContent/Fields');
const UserUpload = require('./Services/UserContent/Upload');
const UserDownload = require('./Services/UserContent/Download');
const UserList = require('./Services/UserContent/List');
const GetAccount = require('./Services/Account/GetAccount');
const UpdateAccount = require('./Services/Account/UpdateAccount');
const ContentMessage = require('./Services/ContentMessage/Message');
const CheckDLC = require('./Services/Misc/CheckDLCInventory');
const StringsFilter = require('./Services/Misc/StringsFilter');
const MyCareerSave = require('./Services/MyCareer/Save');
const MyCareerAttributes = require('./Services/MyCareer/Attributes/Get');
const MyCareerAddGrindPoints = require('./Services/MyCareer/GrindPoints/AddGrindPoints');
const MyCareerAttributePrices = require('./Services/MyCareer/Attributes/Price');
const Balance = require('./Services/VirtualCurrency/Balance');
const Consumables = require('./Services/VirtualCurrency/GetConsumableInfo');
const VCPrices = require('./Services/VirtualCurrency/GetPrices');
const VCPurchase = require('./Services/VirtualCurrency/Purchase');
const WorldConnect = require('./Services/World/Connect');
const VCEvent = require('./Services/VCEvent/EventProcessor');
const VCReport = require('./Services/VCReport/Batch');
const Video = require('./Services/Video/Enumerate');
const LastGames = require('./Services/GameStats/LastGames');
const LeagueSummary = require('./Services/GameStats/LeagueSummary');
const LeaderBoard = require('./Services/GameStats/LeaderBoard');
const UserLeague = require('./Services/GameStats/UserLeague');
const Matchmaking = require('./Services/GameStats/Matchmaking');
const PlayNowOnline = require('./Services/GameStats/PlayNowOnline');
const WorldGameStats = require('./Services/GameStats/WorldGameStats');
const PackageQuery = require('./Services/NBAToday/PackageQuery');
const Inventory = require('./Services/Inventory/GetWithTag');
const StoreItems = require('./Services/Store/GetItems');
const StoreLayout = require('./Services/Store/GetLayout');
const StoreOverview = require('./Services/Store/GetOverview');
const StoreOwned = require('./Services/Store/GetOwnedItems');
const StorePurchase = require('./Services/Store/Purchase');
const Cdn = require('./Services/Cdn/File');
const MyTeamSessionData = require('./Services/MyTeam/GameSetup/SessionData');
const BlacktopFriends = require('./Services/Blacktop/PlayWithFriends');
const MyTeamCollection = require('./Services/MyTeam/Collection/Actions');
const CareerBadgePrices = require('./Services/Career/Upgrades/BadgePrices');
const ArbitrationUpload = require('./Services/Arbitration/Upload');
const MyCareerDownload = require('./Services/MyCareer/Online/Download');
const MyCareerEnumerateVerify = require('./Services/MyCareer/Online/EnumerateVerify');
const MyCareerUpload = require('./Services/MyCareer/Online/Upload');
const MyCareerDelete = require('./Services/MyCareer/Online/Delete');
const ContentMessageRetrieve = require('./Services/ContentMessage/Retrieve');
const MyTeamActiveLineup = require('./Services/MyTeam/Lineup/GetActive');
const MyTeamItemCache = require('./Services/MyTeam/Collection/ItemCache');
const MPStoreOverview = require('./Services/Store/MPStore/Overview');
const MyCourtBanners = require('./Services/GameLoader/MyCourt/Banners');
const MyCourt = require('./Services/MyCourt/Endpoints');
const Gambling = require('./Services/Gambling/Endpoints');
const ProAm = require('./Services/ProAm/Endpoints');

const CareerSaveId = 0xd5e5f21d;
const CareerSlot = 0x5eeda966;

function LoadConfig(File = Path.resolve(__dirname, '../Config.json')) {
    const Root = Path.dirname(File);
    const Raw = JSON.parse(Fs.readFileSync(File, 'utf8'));
    const Resolve = (Value) => Path.resolve(Root, Value);
    return {
        ...Raw,
        Port: Number(process.env.GRANITE_PORT || Raw.Port || 21000),
        Host: process.env.GRANITE_HOST || Raw.Host || '0.0.0.0',
        CertificateDirectory: Resolve(Raw.CertificateDirectory || 'Storage/Certificate'),
        CaptureDirectory: Resolve(process.env.GRANITE_CAPTURE_DIR || Raw.CaptureDirectory || 'Storage/Captures/Http'),
        UserContentDirectory: Resolve(
            process.env.GRANITE_USER_CONTENT_DIR || Raw.UserContentDirectory || 'Storage/UserContent',
        ),
        SessionDirectory: Resolve(process.env.GRANITE_SESSION_DIR || Raw.SessionDirectory || 'Storage/Sessions'),
        AutomaticOwnershipCatalog: Resolve(Raw.AutomaticOwnershipCatalog || 'Storage/Inventory/AutomaticCatalog.json'),
        AttributeProfiles: Resolve(
            process.env.GRANITE_ATTRIBUTE_PROFILES || Raw.AttributeProfiles || 'Storage/Career/AttributeProfiles.json',
        ),
        CareerAttributes: Resolve(
            process.env.GRANITE_CAREER_ATTRIBUTES || Raw.CareerAttributes || 'Storage/Career/Attributes.json',
        ),
        CareerOverall: Resolve(
            process.env.GRANITE_CAREER_OVERALL || Raw.CareerOverall || 'Storage/Career/Overall.json',
        ),
        CareerGrind: Resolve(process.env.GRANITE_CAREER_GRIND || Raw.CareerGrind || 'Storage/Career/GrindPoints.json'),
        ArbitrationDirectory: Resolve(
            process.env.GRANITE_ARBITRATION_DIR || Raw.ArbitrationDirectory || 'Storage/Arbitration',
        ),
        VirtualCurrencyStatic:
            process.env.GRANITE_VC_STATIC === undefined
                ? Raw.VirtualCurrencyStatic !== false
                : !['0', 'false', 'no', 'off'].includes(String(process.env.GRANITE_VC_STATIC).trim().toLowerCase()),
        CdnDirectory: Resolve(process.env.GRANITE_CDN_DIR || Raw.CdnDirectory || 'Storage/Cdn'),
        EndpointTable: Resolve(
            process.env.GRANITE_ENDPOINT_TABLE || Raw.EndpointTable || 'Storage/Session/Login/Endpoints2K19.json',
        ),
        MaximumBodyBytes: Number(Raw.MaximumBodyBytes || 64 * 1024 * 1024),
    };
}

function LoadAttributeProfiles(File) {
    try {
        const Raw = JSON.parse(Fs.readFileSync(File, 'utf8'));
        const Profiles = new Map();
        if (Raw && typeof Raw === 'object' && !Array.isArray(Raw)) {
            for (const [Key, Value] of Object.entries(Raw)) {
                if (Value && typeof Value === 'object') Profiles.set(String(Key), Value);
            }
        }
        return Profiles;
    } catch (Failure) {
        if (Failure.code !== 'ENOENT') Logger.Verbose(`attribute profiles unavailable: ${Failure.message}`);
        return new Map();
    }
}

function SaveAttributeProfiles(File, Profiles) {
    if (!(Profiles instanceof Map)) return;
    const Output = Object.fromEntries(Profiles.entries());
    Fs.mkdirSync(Path.dirname(File), { recursive: true });
    const Temporary = `${File}.${process.pid}.tmp`;
    Fs.writeFileSync(Temporary, `${JSON.stringify(Output, null, 2)}\n`, 'utf8');
    Fs.renameSync(Temporary, File);
}

function LoadCareers(File) {
    try {
        const Raw = JSON.parse(Fs.readFileSync(File, 'utf8'));
        const Careers = new Map();
        if (Raw && typeof Raw === 'object' && !Array.isArray(Raw)) {
            for (const [Key, Value] of Object.entries(Raw)) {
                if (Array.isArray(Value)) Careers.set(String(Key), Value);
            }
        }
        return Careers;
    } catch (Failure) {
        if (Failure.code !== 'ENOENT') Logger.Verbose(`career attributes unavailable: ${Failure.message}`);
        return new Map();
    }
}

function SaveCareers(File, Careers) {
    if (!(Careers instanceof Map)) return;
    const Output = {};
    for (const [Key, Attributes] of Careers.entries()) {
        if (!Array.isArray(Attributes)) continue;
        Output[Key] = Attributes.map((Item) => ({
            id: Number(Item.id) >>> 0,
            level: String(Item.level ?? 0n),
            initial: String(Item.initial ?? 0n),
            cap: String(Item.cap ?? 0n),
            maxLevel: String(Item.maxLevel ?? 0n),
        }));
    }
    Fs.mkdirSync(Path.dirname(File), { recursive: true });
    const Temporary = `${File}.${process.pid}.tmp`;
    Fs.writeFileSync(
        Temporary,
        `${JSON.stringify(Output, null, 2)}
`,
        'utf8',
    );
    Fs.renameSync(Temporary, File);
}

function ReadBody(Req, Maximum) {
    return new Promise((Resolve, Reject) => {
        const Chunks = [];
        let Length = 0;
        Req.on('data', (Chunk) => {
            Length += Chunk.length;
            if (Length > Maximum) {
                Reject(new Error(`request body exceeds ${Maximum} bytes`));
                Req.destroy();
                return;
            }
            Chunks.push(Chunk);
        });
        Req.on('end', () => Resolve(Buffer.concat(Chunks)));
        Req.on('error', Reject);
    });
}

function RequestId(Req) {
    return String(
        Req.headers['vc-request-id'] ||
            Req.headers['x-vc-request-id'] ||
            `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
}

function SessionKey(Url) {
    try {
        return new URL(Url, 'https://granite.invalid').searchParams.get('x') || '';
    } catch {
        return '';
    }
}

function RouteKey(Url) {
    let Pathname = '/';
    try {
        Pathname = new URL(Url, 'https://granite.invalid').pathname;
    } catch {
        Pathname = Url;
    }
    const Parts = Pathname.split('/').filter(Boolean);
    return Parts.slice(-2).join('/').toLowerCase();
}

function DeclaredFieldListSize(Req) {
    const Raw = Req.headers.vcfieldlist_size || Req.headers['vcfieldlist-size'];
    if (Raw === undefined) return 0;
    const Size = Number(Raw);
    return Number.isSafeInteger(Size) && Size > 0 ? Size : 0;
}

function LogParsed(Parsed) {
    if (!Parsed) return Logger.Verbose('empty request body');
    Logger.Verbose(
        `VcFieldList: ${Parsed.Fields.length} field(s), ${Parsed.Data.length} data byte(s), ${Parsed.Trailing.length} trailing byte(s)`,
    );
    for (const Field of Parsed.Fields) {
        const Name = Names.Resolve(Field.Crc) || Field.CrcHex;
        let Value = Field.value;
        if (Buffer.isBuffer(Value))
            Value = `<${Value.length} bytes ${Value.subarray(0, 16).toString('hex')}${Value.length > 16 ? '...' : ''}>`;
        else if (typeof Value === 'bigint') Value = `${Value} (0x${Value.toString(16).toUpperCase()})`;
        Logger.Detail(`[${String(Field.index).padStart(3)}] ${Name} ${Field.TypeName}/${Field.TypeHex} = ${Value}`);
    }
}

function LoadCelestialOptions(Config = {}) {
    let PublicKeyPem = Config.CelestialTicketPublicKey || null;
    if (!PublicKeyPem && Config.CelestialTicketPublicKeyFile) {
        try {
            PublicKeyPem = Fs.readFileSync(Path.resolve(Config.CelestialTicketPublicKeyFile), 'utf8');
        } catch (Failure) {
            Logger.Error(`could not read CelestialTicketPublicKeyFile: ${Failure.message}`);
        }
    }
    const SharedSecret = Config.CelestialTicketSharedSecret || process.env.CELESTIAL_TICKET_SHARED_SECRET || null;
    if (!PublicKeyPem && !SharedSecret && Config.RequireVerifiedIdentity === true) {
        Logger.Error(
            'RequireVerifiedIdentity is set but no Celestial public key is configured; all logins will be denied',
        );
    }
    return {
        PublicKeyPem,
        SharedSecret,
        Issuer: Config.CelestialIssuer || process.env.CELESTIAL_TICKET_ISSUER || null,
        Audience: Config.CelestialAudience || process.env.CELESTIAL_TICKET_AUDIENCE || null,
        TicketHeader: Config.CelestialTicketHeader || undefined,
    };
}

function ResolveContext(Input, Sessions, Key) {
    const Fields = Input.Parsed?.Fields || [];
    const BodyUser = GetU64(Fields, UserFields.UserId);
    const AuthenticatedBodyUser = BodyUser !== null && BodyUser !== 0n ? BodyUser : null;
    const Gamertag = GetString8(Fields, Login.Crcs.GamertagLogin) || GetString8(Fields, Login.Crcs.Gamertag) || '';
    let Current = Key ? Sessions.get(Key) : null;
    if (Current && (AuthenticatedBodyUser !== null || Gamertag)) {
        Current = Sessions.bind(Key, { userId: AuthenticatedBodyUser, gamertag: Gamertag });
    }
    const SessionUser = Current?.userId !== undefined && Current?.userId !== 0n ? Current.userId : null;
    const EffectiveUserId = Current?.verified
        ? (SessionUser ?? AuthenticatedBodyUser)
        : (AuthenticatedBodyUser ?? SessionUser);
    const RequestedCareerSaveId = GetU64(Fields, CareerSaveId) ?? 0n;
    const RequestedSlot = GetU64(Fields, CareerSlot);
    if (Current && RequestedSlot !== null)
        Current = Sessions.bind(Key, { careerSlot: RequestedSlot.toString() }) || Current;
    const CareerSlotValue =
        RequestedSlot !== null
            ? RequestedSlot.toString()
            : Current?.careerSlot !== undefined && Current?.careerSlot !== null
              ? String(Current.careerSlot)
              : null;
    const CareerScopeId =
        RequestedCareerSaveId !== 0n
            ? RequestedCareerSaveId.toString()
            : CareerSlotValue !== null
              ? `slot-${CareerSlotValue}`
              : Current?.careerScopeId || '0';
    return {
        SessionKey: Key,
        userId: EffectiveUserId,
        RequestUserId: BodyUser,
        verified: Boolean(Current?.verified),
        celestialUserId: Current?.celestialUserId ?? null,
        gamertag: Gamertag || Current?.gamertag || '',
        CareerSaveId: RequestedCareerSaveId,
        careerSlot: CareerSlotValue,
        careerScopeId: CareerScopeId,
    };
}

function NormalizeReply(Reply) {
    if (Buffer.isBuffer(Reply)) return { Body: Reply, FieldListSize: Reply.length };
    if (Reply && Buffer.isBuffer(Reply.Body)) return Reply;
    return Acknowledge.Build();
}

function Send(Res, Req, Reply, CaptureBase = null) {
    const Output = NormalizeReply(Reply);
    if (CaptureBase) Capture.SaveResponse(CaptureBase, Req, Output);
    Res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Vc-Request-Id': RequestId(Req),
        'Content-Length': String(Output.Body.length),
        VCFIELDLIST_SIZE: String(Output.FieldListSize),
        Connection: 'close',
    });
    Res.end(Output.Body);
}

function CreateHandler(Config, Dependencies = {}) {
    const Sessions = Dependencies.Sessions || new SessionStore(Config.SessionDirectory);
    const Content = Dependencies.content || new ContentStore(Config.UserContentDirectory);
    const CareerAttributesFile =
        Config.CareerAttributes || Path.resolve(__dirname, '../Storage/Career/Attributes.json');
    const Careers = Dependencies.Careers || LoadCareers(CareerAttributesFile);
    const AttributeProfiles =
        Dependencies.AttributeProfiles ||
        Dependencies.BuildProfiles ||
        LoadAttributeProfiles(
            Config.AttributeProfiles || Path.resolve(__dirname, '../Storage/Career/AttributeProfiles.json'),
        );
    const Wallets = Dependencies.Wallets || new Map();
    const VcPrices = Dependencies.VcPrices || new Map();
    const Purchases = Dependencies.Purchases || new Map();
    const OwnedItemsFile =
        Config.OwnedItemsFile ||
        process.env.GRANITE_OWNED_ITEMS ||
        Path.resolve(__dirname, '../Storage/Inventory/OwnedItems.json');
    const OwnedItems = Dependencies.OwnedItems || LoadOwnedItems(OwnedItemsFile);
    const AutomaticOwnedItems =
        Dependencies.AutomaticOwnedItems ||
        (Config.AutomaticOwnership === true ? LoadAutomaticItems(Config.AutomaticOwnershipCatalog) : []);
    if (AutomaticOwnedItems.length)
        Logger.Info(`automatic ownership enabled: ${AutomaticOwnedItems.length} catalog items for signed-in accounts`);
    let StoreCatalogPrices = Dependencies.StoreCatalogPrices || null;
    if (!StoreCatalogPrices) {
        try {
            StoreCatalogPrices = LoadCatalogPrices(Config.AutomaticOwnershipCatalog);
            Logger.Info(`store catalog prices loaded: ${StoreCatalogPrices.size} items`);
        } catch (Failure) {
            StoreCatalogPrices = new Map();
            Logger.Error(
                `store catalog prices unavailable (${Failure.message}); consumable carts use ITEM%d_EXPECTED_PRICE`,
            );
        }
    }
    const ProAmTeams = Dependencies.ProAmTeams || new Map();
    const MatchmakingData =
        Dependencies.Matchmaking ||
        Matchmaking.Create({
            PublicHost: Config.PublicHost,
            RelayPort: Config.RelayPort,
            RelayId: Config.RelaySessionPort,
        });
    const CareerOverallFile = Config.CareerOverall || Path.resolve(__dirname, '../Storage/Career/Overall.json');
    let CareerOveralls = Dependencies.CareerOveralls || null;
    if (!CareerOveralls) {
        try {
            CareerOveralls = LoadCareerOveralls(CareerOverallFile);
        } catch (Failure) {
            CareerOveralls = new Map();
            Logger.Error(`career overall ratings unavailable (${Failure.message})`);
        }
    }
    const CareerGrindFile = Config.CareerGrind || Path.resolve(__dirname, '../Storage/Career/GrindPoints.json');
    let CareerGrind = Dependencies.CareerGrind || null;
    if (!CareerGrind) {
        try {
            CareerGrind = LoadCareerGrind(CareerGrindFile);
        } catch (Failure) {
            CareerGrind = new Map();
            Logger.Error(`career grind points unavailable (${Failure.message})`);
        }
    }
    const CelestialIdentity = Dependencies.CelestialIdentity || CreateCelestialIdentity(LoadCelestialOptions(Config));
    const RequireVerifiedIdentity =
        Config.RequireVerifiedIdentity === true || process.env.CELESTIAL_REQUIRE_VERIFIED_IDENTITY === '1';
    return async function Handle(Req, Res) {
        const Body = await ReadBody(Req, Config.MaximumBodyBytes);
        const Key = SessionKey(Req.url || '/');
        const Route = RouteKey(Req.url || '/');
        const FullUrl = String(Req.url || '/').toLowerCase();
        Logger.Info(`${Req.method || 'GET'} ${Req.url || '/'}${Key ? ` session=${Key}` : ''}`);

        let Parsed = null;
        if (Body.length) {
            const Result = TryParse(Body, { FieldListSize: DeclaredFieldListSize(Req) || undefined });
            if (Result.Ok) Parsed = Result.Parsed;
            else Logger.Verbose(`body is not a valid VcFieldList: ${Result.Error.message}`);
        }
        LogParsed(Parsed);
        const Base = Capture.Save(Config.CaptureDirectory, Req, Body);
        Logger.Verbose(`captured request at ${Base}.bin`);

        const Input = { Body, Parsed, headers: Req.headers || {} };
        const Context = {
            ...ResolveContext(Input, Sessions, Key),
            Sessions,
            content: Content,
            Careers,
            AttributeProfiles,
            BuildProfiles: AttributeProfiles,
            Wallets,
            VcPrices,
            Purchases,
            ProAmTeams,
            OwnedItems,
            AutomaticOwnedItems,
            StoreCatalogPrices,
            Matchmaking: MatchmakingData,
            SaveAttributeProfiles: () => SaveAttributeProfiles(Config.AttributeProfiles, AttributeProfiles),
            SaveCareers: () => SaveCareers(CareerAttributesFile, Careers),
            SaveOwnedItems: () => SaveOwnedItems(OwnedItemsFile, OwnedItems),
            VirtualCurrencyStatic: Config.VirtualCurrencyStatic !== false,
            EndpointFile: Config.EndpointTable,
            PublicHost: Config.PublicHost,
            WorldPort: Config.WorldPort,
            RelayPort: Config.RelayPort,
            RelayId: Config.RelaySessionPort,
            CdnDirectory: Config.CdnDirectory,
            Identity: CelestialIdentity,
            RequireVerifiedIdentity,
            RequireKnownAttributeProfile: true,
            CareerOveralls,
            CareerGrind,
            ArbitrationDirectory: Config.ArbitrationDirectory || Path.resolve(__dirname, '../Storage/Arbitration'),
            SaveCareerGrind: () => {
                if (!Dependencies.CareerGrind) SaveCareerGrind(CareerGrindFile, CareerGrind);
            },
        };
        const ReportedOverall = RecordOverall(Parsed?.Fields, CareerKey(Context), CareerOveralls);
        if (ReportedOverall !== null) {
            Logger.Info(`career ${CareerKey(Context)} reports overall ${ReportedOverall}`);
            if (!Dependencies.CareerOveralls) {
                try {
                    SaveCareerOveralls(CareerOverallFile, CareerOveralls);
                } catch (Failure) {
                    Logger.Error(`could not save career overall ratings: ${Failure.message}`);
                }
            }
        }

        const CdnData = Req.method === 'GET' ? Cdn.Read(Req.url || '/', Config.CdnDirectory) : null;
        if (CdnData) {
            Logger.Info(`CDN served ${Req.url} (${CdnData.length} bytes)`);
            Res.writeHead(200, {
                'Content-Type': 'application/octet-stream',
                'Content-Length': String(CdnData.length),
                Connection: 'close',
            });
            Res.end(CdnData);
            return;
        }
        if (Req.method === 'GET' && Cdn.Normalise(Req.url || '/')) {
            Logger.Error(`CDN file missing: ${Req.url}`);
            Res.writeHead(404, { 'Content-Length': '0', Connection: 'close' });
            Res.end();
            return;
        }

        let Reply;
        if (Route === 'session/login') Reply = Login.Build(Input, Context);
        else if (Route === 'session/update') Reply = SessionUpdate.Build(Input, Context);
        else if (Route === 'usercontent/upload' || Route === 'userdatasync/upload')
            Reply = UserUpload.Build(Input, Context);
        else if (
            Route === 'usercontent/download' ||
            Route === 'usercontent/userdownload' ||
            Route === 'usercontent/debug_download' ||
            Route === 'userdatasync/download'
        )
            Reply = UserDownload.Build(Input, Context);
        else if (
            Route === 'usercontent/list' ||
            Route === 'usercontent/list2' ||
            Route === 'usercontent/userlist' ||
            Route === 'userdatasync/list'
        )
            Reply = UserList.Build(Input, Context);
        else if (Route === 'accounts/get' || Route === 'account/get') Reply = GetAccount.Build(Input, Context);
        else if (Route === 'accounts/update' || Route === 'accounts/update_account' || Route === 'account/update')
            Reply = UpdateAccount.Build(Input, Context);
        else if (Route === 'contentmessage/retrieve') Reply = ContentMessageRetrieve.Build(Input, Context);
        else if (Route.startsWith('contentmessage/')) Reply = ContentMessage.Build(Input, Context);
        else if (Route.startsWith('dlc/')) Reply = CheckDLC.Build(Input, Context);
        else if (Route === 'strings/filter') Reply = StringsFilter.Build(Input, Context);
        else if (Route === 'mycareer/save') Reply = MyCareerSave.Build(Input, Context);
        else if (Route === 'online/download' || FullUrl.includes('/mycareer/online/download'))
            Reply = MyCareerDownload.Build(Input, Context);
        else if (
            Route === 'online/enumerate' ||
            Route === 'online/verify' ||
            FullUrl.includes('/mycareer/online/enumerate') ||
            FullUrl.includes('/mycareer/online/verify')
        )
            Reply = MyCareerEnumerateVerify.Build(Input, Context);
        else if (Route === 'online/upload' || FullUrl.includes('/mycareer/online/upload'))
            Reply = MyCareerUpload.Build(Input, Context);
        else if (Route === 'online/delete' || FullUrl.includes('/mycareer/online/delete'))
            Reply = MyCareerDelete.Build(Input, Context);
        else if (Route === 'myteam/session_data' || Route === 'myteam/sessiondata')
            Reply = MyTeamSessionData.Build(Input, Context);
        else if (
            Route === 'collection/action' ||
            Route === 'collection/actions' ||
            Route === 'myteam/collection/action' ||
            Route === 'myteam/collection/actions'
        )
            Reply = MyTeamCollection.Build(Input, Context);
        else if (Route === 'lineup/active' || Route === 'myteam/get_active_lineup' || MyTeamActiveLineup.Resolve(Route))
            Reply = MyTeamActiveLineup.Build(Input, Context);
        else if (MyTeamItemCache.Resolve(Route)) Reply = MyTeamItemCache.Build(Input, { ...Context, Route });
        else if (Route === 'blacktop/playwithfriends' || Route === 'blacktop/play_with_friends')
            Reply = BlacktopFriends.Build(Input, Context);
        else if (Route === 'upgrades/badge_prices' || Route === 'career/badge_prices')
            Reply = CareerBadgePrices.Build(Input, Context);
        else if (ArbitrationUpload.Resolve(Route) !== null)
            Reply = ArbitrationUpload.Build(Input, { ...Context, Route });
        else if (Route === 'attributes/get' || Route === 'mycareerv3/getmycareerattributesofdefaultsave')
            Reply = MyCareerAttributes.Build(Input, Context);
        else if (Route === 'mycareerv3/addgrindpoints') Reply = MyCareerAddGrindPoints.Build(Input, Context);
        else if (Route === 'attributes/price') Reply = MyCareerAttributePrices.Build(Input, Context);
        else if (Route === 'virtualcurrency/balance') Reply = Balance.Build(Input, Context);
        else if (Route === 'virtualcurrency/get_prices') Reply = VCPrices.Build(Input, Context);
        else if (Route === 'virtualcurrency/get_consumable_info') Reply = Consumables.Build(Input, Context);
        else if (Route === 'virtualcurrency/spend_consumable_consume') Reply = Consumables.Consume(Input, Context);
        else if (Route === 'virtualcurrency/spend_consumable_purchase')
            Reply = VCPurchase.BuildConsumable(Input, Context);
        else if (Route === 'virtualcurrency/purchase') Reply = VCPurchase.Build(Input, Context);
        else if (Route === 'world/connect') Reply = WorldConnect.Build(Input, Context);
        else if (Route.startsWith('gambling/') || FullUrl.includes('/gambling/')) {
            let Pathname = Req.url || '/';
            try {
                Pathname = new URL(Pathname, 'https://granite.invalid').pathname.toLowerCase();
            } catch {
                Pathname = String(Pathname).toLowerCase();
            }
            const Marker = Pathname.indexOf('/gambling/');
            const GamblingRoute = Marker >= 0 ? Pathname.slice(Marker + 1) : Route;
            Reply = Gambling.Build(Input, { ...Context, Route: GamblingRoute });
        } else if (FullUrl.includes('/vceventv2/') || Route === 'vcevent/event_processor')
            Reply = VCEvent.Build(Input, Context);
        else if (Route.startsWith('vcreport/')) Reply = VCReport.Build(Input, Context);
        else if (ProAm.Resolve(Req.url || Route)) {
            Reply = ProAm.Build(Input, { ...Context, Route: Req.url || Route });
        } else if (Route !== 'mycourt/banners' && (Route.startsWith('mycourt/') || FullUrl.includes('/mmg/mycourt/'))) {
            let Pathname = Req.url || '/';
            try {
                Pathname = new URL(Pathname, 'https://granite.invalid').pathname.toLowerCase();
            } catch {
                Pathname = String(Pathname).toLowerCase();
            }
            const Marker = Pathname.indexOf('/mycourt/');
            const MyCourtRoute = Marker >= 0 ? Pathname.slice(Marker + 1) : Route;
            Reply = MyCourt.Build(Input, { ...Context, Route: MyCourtRoute });
        } else if (Route.startsWith('video/enumerate') || Route === 'nbatoday/videoquery')
            Reply = Video.Build(Input, Context);
        else if (Route === 'nbatoday/packagequery') Reply = PackageQuery.Build(Input, Context);
        else if (PlayNowOnline.Resolve(Route)) Reply = PlayNowOnline.Build(Input, { ...Context, Route });
        else if (Route === 'gamestatsv4/get_world_game_stats' || Route === 'gamestatsv4/get_user_status')
            Reply = WorldGameStats.Build(Input, Context);
        else if (Route.includes('lastngamestats') || Route === 'gamestats/lastgames')
            Reply = LastGames.Build(Input, Context);
        else if (Route.includes('tiersummary') || Route === 'gamestats/leaguesummary')
            Reply = LeagueSummary.Build(Input, Context);
        else if (Route === 'gamestats/leaderboard') Reply = LeaderBoard.Build(Input, Context);
        else if (Route === 'gamestats/userleague') Reply = UserLeague.Build(Input, Context);
        else if (
            Route === 'quick/search' ||
            Route === 'quick/update' ||
            Route === 'quick/interlockedupdate' ||
            Route === 'quick/leave' ||
            Route === 'quick/remove' ||
            Route.startsWith('mmg/') ||
            Route.startsWith('gamestats/matchmaking')
        ) {
            Reply = Matchmaking.Build(Input, { ...Context, Route });
        } else if (Route === 'inventory/getwithtag' || Route === 'inventory/get_with_tag')
            Reply = Inventory.Build(Input, Context);
        else if (
            Route === 'store/getitems' ||
            Route === 'store/get_items' ||
            Route === 'storev4/v4/get_items' ||
            Route === 'v4/get_items'
        )
            Reply = StoreItems.Build(Input, Context);
        else if (
            Route === 'store/getlayout' ||
            Route === 'store/get_layout' ||
            Route === 'storev4/v4/get_layout' ||
            Route === 'v4/get_layout'
        )
            Reply = StoreLayout.Build(Input, Context);
        else if (Route === 'store/getoverview' || Route === 'store/get_overview' || Route === 'v4/get_overview')
            Reply = StoreOverview.Build(Input, Context);
        else if (Route === 'mpstore/overview' || Route === 'store/mpstore_overview')
            Reply = MPStoreOverview.Build(Input, Context);
        else if (Route === 'store/getowneditems' || Route === 'store/get_owned_items' || Route === 'v4/get_owned_items')
            Reply = StoreOwned.Build(Input, Context);
        else if (Route === 'store/purchase' || Route === 'v4/purchase') Reply = StorePurchase.Build(Input, Context);
        else if (Route === 'mycourt/banners' || Route === 'gameloader/mycourt_banners')
            Reply = MyCourtBanners.Build(Input, Context);
        else if (Route === 'session/destroy') Reply = Acknowledge.Build(Input, Context);
        else if (Route.startsWith('usercontent/')) Reply = Acknowledge.Build(Input, Context);
        else if (Route.startsWith('virtualcurrency/') || Route.startsWith('virtualcurrencyv3/'))
            Reply = Acknowledge.Build(Input, Context);
        else if (Route.startsWith('storev4/') || Route.startsWith('v4/')) Reply = Acknowledge.Build(Input, Context);
        else {
            Logger.Verbose(`unmodeled ${Route || '/'}; returning RESULT=SUCCESS after capture`);
            Reply = Acknowledge.Build();
        }
        Send(Res, Req, Reply, Base);
    };
}

function CreateGraniteServer(Config = LoadConfig(), Dependencies = {}) {
    const Certificate = Dependencies.Certificate || Generate(Config.CertificateDirectory, Logger);
    const Handler = CreateHandler(Config, Dependencies);
    const Server = Https.createServer(
        {
            cert: Fs.readFileSync(Certificate.Crt),
            key: Fs.readFileSync(Certificate.key),
            minVersion: 'TLSv1.2',
        },
        (Req, Res) => {
            Handler(Req, Res).catch((Failure) => {
                Logger.Error('request failed', Failure);
                if (!Res.headersSent) {
                    const Reply = Acknowledge.Build();
                    Send(Res, Req, Reply);
                } else Res.destroy(Failure);
            });
        },
    );
    return { Server, Config };
}

function Start() {
    const Instance = CreateGraniteServer();
    Instance.Server.listen(Instance.Config.Port, Instance.Config.Host, () => {
        Logger.Info(`Granite NBA2K19 HTTPS server listening on ${Instance.Config.Host}:${Instance.Config.Port}`);
        Logger.Info(`captures: ${Instance.Config.CaptureDirectory}`);
        Logger.Info(`endpoint table: ${Instance.Config.EndpointTable}`);
    });
    return Instance;
}

if (require.main === module) Start();

module.exports = {
    LoadConfig,
    ReadBody,
    RouteKey,
    DeclaredFieldListSize,
    CreateHandler,
    CreateGraniteServer,
    Start,
    Send,
    LoadCareers,
    SaveCareers,
};
