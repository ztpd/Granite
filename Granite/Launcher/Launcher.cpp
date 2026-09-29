// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0A00
#endif

#include <windows.h>
#include <tlhelp32.h>

#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cwctype>
#include <filesystem>
#include <fstream>
#include <limits>
#include <sstream>
#include <string>
#include <vector>

#pragma comment(lib, "Advapi32.lib")

namespace fs = std::filesystem;

namespace
{
constexpr wchar_t GameExecutableName[] = L"NBA2K19.exe";
constexpr wchar_t InjectorExecutableName[] = L"Injector.exe";
constexpr wchar_t ModuleName[] = L"Module.dll";
constexpr wchar_t PathFileName[] = L"Path.txt";
constexpr wchar_t ReadinessModuleName[] = L"kernel32.dll";
constexpr DWORD ReadinessTimeoutMs = 30'000;
constexpr DWORD ReadinessPollMs = 250;
constexpr std::uint64_t SteamId64Base = 76561197960265728ull;
constexpr std::uint32_t DefaultEmulatorAccountId = 1638u;

enum class ExitCode : int
{
    Success = 0,
    ConfigurationError = 10,
    ValidationError = 11,
    GameLaunchError = 12,
    GameReadinessError = 13,
    InjectorLaunchError = 14,
    InjectorWaitError = 15,
    UnexpectedError = 16,
};

enum class LogLevel
{
    Info,
    Verbose,
    Error,
};

class UniqueHandle
{
public:
    UniqueHandle() noexcept = default;
    explicit UniqueHandle(HANDLE InHandle) noexcept : Handle(InHandle) {}

    ~UniqueHandle() { Reset(); }

    UniqueHandle(const UniqueHandle&) = delete;
    UniqueHandle& operator=(const UniqueHandle&) = delete;

    UniqueHandle(UniqueHandle&& Other) noexcept : Handle(Other.Release()) {}

    UniqueHandle& operator=(UniqueHandle&& Other) noexcept
    {
        if (this != &Other)
        {
            Reset(Other.Release());
        }
        return *this;
    }

    [[nodiscard]] bool Valid() const noexcept { return Handle != nullptr && Handle != INVALID_HANDLE_VALUE; }

    [[nodiscard]] HANDLE Get() const noexcept { return Handle; }

    HANDLE Release() noexcept
    {
        HANDLE Released = Handle;
        Handle = nullptr;
        return Released;
    }

    void Reset(HANDLE Replacement = nullptr) noexcept
    {
        if (Valid())
        {
            CloseHandle(Handle);
        }
        Handle = Replacement;
    }

private:
    HANDLE Handle = nullptr;
};

void Log(LogLevel Level, const std::wstring& Message)
{
    const bool IsError = Level == LogLevel::Error;
    FILE* Stream = IsError ? stderr : stdout;
    HANDLE Output = GetStdHandle(IsError ? STD_ERROR_HANDLE : STD_OUTPUT_HANDLE);

    const wchar_t* Label = L"INFO";
    WORD Color = FOREGROUND_GREEN | FOREGROUND_INTENSITY;
    if (Level == LogLevel::Verbose)
    {
        Label = L"VERBOSE";
        Color = FOREGROUND_RED | FOREGROUND_GREEN | FOREGROUND_INTENSITY;
    }
    else if (Level == LogLevel::Error)
    {
        Label = L"ERROR";
        Color = FOREGROUND_RED | FOREGROUND_INTENSITY;
    }

    CONSOLE_SCREEN_BUFFER_INFO Original{};
    const bool HasConsole =
        Output != nullptr && Output != INVALID_HANDLE_VALUE && GetConsoleScreenBufferInfo(Output, &Original) != FALSE;
    if (HasConsole)
    {
        SetConsoleTextAttribute(Output, Color);
    }

    std::fwprintf(Stream, L"[%ls] %ls\n", Label, Message.c_str());
    std::fflush(Stream);

    if (HasConsole)
    {
        SetConsoleTextAttribute(Output, Original.wAttributes);
    }
}

std::wstring DescribeWindowsError(DWORD Error)
{
    wchar_t* RawMessage = nullptr;
    const DWORD Count =
        FormatMessageW(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
                       nullptr, Error, 0, reinterpret_cast<wchar_t*>(&RawMessage), 0, nullptr);

    std::wstring Message;
    if (Count != 0 && RawMessage != nullptr)
    {
        Message.assign(RawMessage, Count);
        LocalFree(RawMessage);
        while (!Message.empty() && std::iswspace(Message.back()) != 0)
        {
            Message.pop_back();
        }
    }

    std::wostringstream Result;
    Result << L"Windows error " << Error;
    if (!Message.empty())
    {
        Result << L": " << Message;
    }
    return Result.str();
}

bool EqualOrdinalIgnoreCase(const std::wstring& Left, const std::wstring& Right)
{
    if (Left.size() > static_cast<std::size_t>(std::numeric_limits<int>::max()) ||
        Right.size() > static_cast<std::size_t>(std::numeric_limits<int>::max()))
    {
        return false;
    }

    return CompareStringOrdinal(Left.data(), static_cast<int>(Left.size()), Right.data(),
                                static_cast<int>(Right.size()), TRUE) == CSTR_EQUAL;
}

std::uint32_t Fnv1a32(const std::string& Value)
{
    std::uint32_t Hash = 2166136261u;
    for (const unsigned char Character : Value)
    {
        Hash ^= Character;
        Hash *= 16777619u;
    }
    return Hash;
}

bool ReadRegistryDword(HKEY Root, const wchar_t* SubKey, const wchar_t* ValueName, DWORD& Value)
{
    DWORD Candidate = 0;
    DWORD Size = sizeof(Candidate);
    if (RegGetValueW(Root, SubKey, ValueName, RRF_RT_REG_DWORD, nullptr, &Candidate, &Size) != ERROR_SUCCESS)
    {
        return false;
    }

    Value = Candidate;
    return true;
}

bool ReadRegistryString(HKEY Root, const wchar_t* SubKey, const wchar_t* ValueName, std::wstring& Value)
{
    wchar_t Buffer[1024]{};
    DWORD Size = sizeof(Buffer);
    if (RegGetValueW(Root, SubKey, ValueName, RRF_RT_REG_SZ, nullptr, Buffer, &Size) != ERROR_SUCCESS)
    {
        return false;
    }

    Value = Buffer;
    return true;
}

bool ReadRegistryString64(HKEY Root, const wchar_t* SubKey, const wchar_t* ValueName, std::wstring& Value)
{
    HKEY Key = nullptr;
    if (RegOpenKeyExW(Root, SubKey, 0, KEY_QUERY_VALUE | KEY_WOW64_64KEY, &Key) != ERROR_SUCCESS)
    {
        return false;
    }

    wchar_t Buffer[1024]{};
    DWORD Size = sizeof(Buffer);
    DWORD Type = 0;
    const LONG Result = RegQueryValueExW(Key, ValueName, nullptr, &Type, reinterpret_cast<LPBYTE>(Buffer), &Size);
    RegCloseKey(Key);
    if (Result != ERROR_SUCCESS || Type != REG_SZ)
    {
        return false;
    }

    Value = Buffer;
    return true;
}

bool BlockIsMostRecent(const std::string& Block)
{
    std::size_t Key = Block.find("\"MostRecent\"");
    if (Key == std::string::npos)
    {
        return false;
    }

    const std::size_t ValueStart = Block.find('"', Key + 12);
    if (ValueStart == std::string::npos)
    {
        return false;
    }

    const std::size_t ValueEnd = Block.find('"', ValueStart + 1);
    return ValueEnd != std::string::npos && Block.substr(ValueStart + 1, ValueEnd - ValueStart - 1) == "1";
}

std::uint32_t AccountFromLoginUsers(const fs::path& LoginUsersPath)
{
    std::ifstream Input(LoginUsersPath, std::ios::binary);
    if (!Input)
    {
        return 0;
    }

    const std::string Content((std::istreambuf_iterator<char>(Input)), std::istreambuf_iterator<char>());
    std::uint64_t FirstSteamId = 0;
    std::uint64_t MostRecentSteamId = 0;
    std::size_t Cursor = 0;
    while ((Cursor = Content.find("\"7656119", Cursor)) != std::string::npos)
    {
        const std::size_t IdStart = Cursor + 1;
        const std::size_t IdEnd = Content.find('"', IdStart);
        if (IdEnd == std::string::npos)
        {
            break;
        }

        const std::string IdText = Content.substr(IdStart, IdEnd - IdStart);
        std::uint64_t SteamId = 0;
        bool Valid = !IdText.empty();
        for (const char Character : IdText)
        {
            if (Character < '0' || Character > '9')
            {
                Valid = false;
                break;
            }
            SteamId = (SteamId * 10u) + static_cast<unsigned int>(Character - '0');
        }

        const std::size_t BlockStart = Content.find('{', IdEnd);
        const std::size_t BlockEnd =
            BlockStart == std::string::npos ? std::string::npos : Content.find('}', BlockStart);
        if (Valid && SteamId >= SteamId64Base)
        {
            if (FirstSteamId == 0)
            {
                FirstSteamId = SteamId;
            }

            const std::string Block =
                BlockStart == std::string::npos
                    ? std::string()
                    : Content.substr(BlockStart,
                                     (BlockEnd == std::string::npos ? Content.size() : BlockEnd) - BlockStart);
            if (BlockIsMostRecent(Block))
            {
                MostRecentSteamId = SteamId;
                break;
            }
        }

        Cursor = BlockEnd == std::string::npos ? IdEnd + 1 : BlockEnd + 1;
    }

    const std::uint64_t Selected = MostRecentSteamId != 0 ? MostRecentSteamId : FirstSteamId;
    return Selected >= SteamId64Base ? static_cast<std::uint32_t>(Selected - SteamId64Base) : 0;
}

std::uint32_t ResolveSteamAccountId(std::uint32_t ExistingRealAccountId)
{
    DWORD ActiveUser = 0;
    if (ReadRegistryDword(HKEY_CURRENT_USER, L"Software\\Valve\\Steam\\ActiveProcess", L"ActiveUser", ActiveUser) &&
        ActiveUser != 0)
    {
        return ActiveUser;
    }

    std::wstring SteamPath;
    if (ReadRegistryString(HKEY_CURRENT_USER, L"Software\\Valve\\Steam", L"SteamPath", SteamPath) && !SteamPath.empty())
    {
        std::replace(SteamPath.begin(), SteamPath.end(), L'/', L'\\');
        const std::uint32_t AccountId = AccountFromLoginUsers(fs::path(SteamPath) / L"config" / L"loginusers.vdf");
        if (AccountId != 0)
        {
            return AccountId;
        }
    }

    if (ExistingRealAccountId != 0)
    {
        return ExistingRealAccountId;
    }

    std::wstring MachineGuid;
    if (ReadRegistryString64(HKEY_LOCAL_MACHINE, L"SOFTWARE\\Microsoft\\Cryptography", L"MachineGuid", MachineGuid) &&
        !MachineGuid.empty())
    {
        std::string NarrowGuid;
        NarrowGuid.reserve(MachineGuid.size());
        for (const wchar_t Character : MachineGuid)
        {
            NarrowGuid.push_back(static_cast<char>(Character & 0x7F));
        }

        std::uint32_t AccountId = Fnv1a32(NarrowGuid);
        if (AccountId == 0 || AccountId == DefaultEmulatorAccountId)
        {
            AccountId += 7;
        }
        return AccountId;
    }

    return 0;
}

bool ParseAccountIdLine(const std::string& Line, bool& Commented, std::uint32_t& Value)
{
    std::size_t Cursor = 0;
    while (Cursor < Line.size() && (Line[Cursor] == ' ' || Line[Cursor] == '\t'))
    {
        ++Cursor;
    }

    Commented = false;
    if (Cursor < Line.size() && Line[Cursor] == '#')
    {
        Commented = true;
        ++Cursor;
        while (Cursor < Line.size() && (Line[Cursor] == ' ' || Line[Cursor] == '\t'))
        {
            ++Cursor;
        }
    }

    constexpr char Key[] = "AccountId";
    if (Line.compare(Cursor, sizeof(Key) - 1, Key) != 0)
    {
        return false;
    }
    Cursor += sizeof(Key) - 1;
    while (Cursor < Line.size() && (Line[Cursor] == ' ' || Line[Cursor] == '\t'))
    {
        ++Cursor;
    }
    if (Cursor >= Line.size() || Line[Cursor] != '=')
    {
        return false;
    }
    ++Cursor;
    while (Cursor < Line.size() && (Line[Cursor] == ' ' || Line[Cursor] == '\t'))
    {
        ++Cursor;
    }

    std::uint64_t Parsed = 0;
    bool HasDigits = false;
    while (Cursor < Line.size() && Line[Cursor] >= '0' && Line[Cursor] <= '9')
    {
        Parsed = (Parsed * 10u) + static_cast<unsigned int>(Line[Cursor] - '0');
        ++Cursor;
        HasDigits = true;
    }
    Value = HasDigits && Parsed <= std::numeric_limits<std::uint32_t>::max() ? static_cast<std::uint32_t>(Parsed) : 0;
    return true;
}

void PatchSteamAccountId(const fs::path& GameDirectory)
{
    const fs::path IniPath = GameDirectory / L"steam_emu.ini";
    std::ifstream Input(IniPath, std::ios::binary);
    if (!Input)
    {
        Log(LogLevel::Verbose, L"[AccountId] steam_emu.ini was not found; continuing without an identity update.");
        return;
    }

    const std::string Content((std::istreambuf_iterator<char>(Input)), std::istreambuf_iterator<char>());
    std::vector<std::string> Lines;
    for (std::size_t Start = 0;;)
    {
        const std::size_t Newline = Content.find('\n', Start);
        if (Newline == std::string::npos)
        {
            Lines.push_back(Content.substr(Start));
            break;
        }
        Lines.push_back(Content.substr(Start, Newline - Start));
        Start = Newline + 1;
    }

    int ActiveIndex = -1;
    int CommentedIndex = -1;
    std::uint32_t ExistingActiveAccountId = 0;
    for (std::size_t Index = 0; Index < Lines.size(); ++Index)
    {
        bool Commented = false;
        std::uint32_t Value = 0;
        if (!ParseAccountIdLine(Lines[Index], Commented, Value))
        {
            continue;
        }
        if (!Commented && ActiveIndex < 0)
        {
            ActiveIndex = static_cast<int>(Index);
            ExistingActiveAccountId = Value;
        }
        else if (Commented && CommentedIndex < 0)
        {
            CommentedIndex = static_cast<int>(Index);
        }
    }

    const std::uint32_t ExistingRealAccountId =
        ExistingActiveAccountId != 0 && ExistingActiveAccountId != DefaultEmulatorAccountId ? ExistingActiveAccountId
                                                                                            : 0;
    const std::uint32_t AccountId = ResolveSteamAccountId(ExistingRealAccountId);
    if (AccountId == 0)
    {
        Log(LogLevel::Verbose,
            L"[AccountId] no Steam or stable local account id was available; steam_emu.ini is unchanged.");
        return;
    }
    if (ExistingActiveAccountId == AccountId)
    {
        Log(LogLevel::Info, L"[AccountId] already set to " + std::to_wstring(AccountId) + L".");
        return;
    }

    const bool Crlf = Content.find("\r\n") != std::string::npos;
    const std::string AccountLine = "AccountId=" + std::to_string(AccountId) + (Crlf ? "\r" : "");
    if (ActiveIndex >= 0)
    {
        Lines[static_cast<std::size_t>(ActiveIndex)] = AccountLine;
    }
    else if (CommentedIndex >= 0)
    {
        Lines[static_cast<std::size_t>(CommentedIndex)] = AccountLine;
    }
    else
    {
        int SettingsIndex = -1;
        for (std::size_t Index = 0; Index < Lines.size(); ++Index)
        {
            std::size_t Cursor = 0;
            while (Cursor < Lines[Index].size() && (Lines[Index][Cursor] == ' ' || Lines[Index][Cursor] == '\t'))
            {
                ++Cursor;
            }
            if (Lines[Index].compare(Cursor, 9, "[Settings") == 0)
            {
                SettingsIndex = static_cast<int>(Index);
                break;
            }
        }

        if (SettingsIndex >= 0)
        {
            Lines.insert(Lines.begin() + SettingsIndex + 1, AccountLine);
        }
        else
        {
            Lines.push_back(AccountLine);
        }
    }

    std::string Updated;
    for (std::size_t Index = 0; Index < Lines.size(); ++Index)
    {
        Updated += Lines[Index];
        if (Index + 1 < Lines.size())
        {
            Updated += '\n';
        }
    }

    std::ofstream Output(IniPath, std::ios::binary | std::ios::trunc);
    if (!Output)
    {
        Log(LogLevel::Verbose,
            L"[AccountId] steam_emu.ini could not be written; continuing without an identity update.");
        return;
    }
    Output.write(Updated.data(), static_cast<std::streamsize>(Updated.size()));
    if (!Output)
    {
        Log(LogLevel::Verbose,
            L"[AccountId] steam_emu.ini write did not complete; continuing without an identity update.");
        return;
    }

    Log(LogLevel::Info, L"[AccountId] set to " + std::to_wstring(AccountId) + L" before NBA2K19 starts.");
}

bool GetExecutablePath(fs::path& Path, DWORD& Error)
{
    std::vector<wchar_t> Buffer(512);
    while (Buffer.size() <= 32'768)
    {
        SetLastError(ERROR_SUCCESS);
        const DWORD Length = GetModuleFileNameW(nullptr, Buffer.data(), static_cast<DWORD>(Buffer.size()));
        if (Length == 0)
        {
            Error = GetLastError();
            return false;
        }
        if (Length < Buffer.size())
        {
            Path = fs::path(std::wstring(Buffer.data(), Length));
            Error = ERROR_SUCCESS;
            return true;
        }
        Buffer.resize(Buffer.size() * 2);
    }

    Error = ERROR_BUFFER_OVERFLOW;
    return false;
}

bool DecodeText(const std::string& Bytes, UINT CodePage, DWORD Flags, std::wstring& Decoded)
{
    if (Bytes.empty())
    {
        Decoded.clear();
        return true;
    }
    if (Bytes.size() > static_cast<std::size_t>(std::numeric_limits<int>::max()))
    {
        return false;
    }

    const int SourceLength = static_cast<int>(Bytes.size());
    const int Required = MultiByteToWideChar(CodePage, Flags, Bytes.data(), SourceLength, nullptr, 0);
    if (Required <= 0)
    {
        return false;
    }

    Decoded.resize(static_cast<std::size_t>(Required));
    return MultiByteToWideChar(CodePage, Flags, Bytes.data(), SourceLength, Decoded.data(), Required) == Required;
}

std::wstring TrimPathLine(std::wstring Value)
{
    const auto IsTrimCharacter = [](wchar_t Character)
    { return Character == L' ' || Character == L'\t' || Character == L'\r' || Character == L'\n'; };

    const auto First = std::find_if_not(Value.begin(), Value.end(), IsTrimCharacter);
    const auto Last = std::find_if_not(Value.rbegin(), Value.rend(), IsTrimCharacter).base();
    if (First >= Last)
    {
        return {};
    }

    Value = std::wstring(First, Last);
    if (Value.size() >= 2 && Value.front() == L'"' && Value.back() == L'"')
    {
        Value = Value.substr(1, Value.size() - 2);
    }
    return Value;
}

bool ReadGameDirectory(const fs::path& PathFile, std::wstring& Directory, std::wstring& Failure)
{
    std::ifstream Input(PathFile, std::ios::binary | std::ios::ate);
    if (!Input)
    {
        Failure = L"Could not open " + PathFile.wstring();
        return false;
    }

    const std::streamoff Size = Input.tellg();
    if (Size < 0 || Size > 128 * 1024)
    {
        Failure = L"Path.txt is unreadable or unexpectedly large.";
        return false;
    }

    Input.seekg(0, std::ios::beg);
    std::string Bytes(static_cast<std::size_t>(Size), '\0');
    if (!Bytes.empty())
    {
        Input.read(Bytes.data(), static_cast<std::streamsize>(Bytes.size()));
        if (!Input)
        {
            Failure = L"Could not completely read Path.txt.";
            return false;
        }
    }

    std::wstring Line;
    if (Bytes.size() >= 2 && static_cast<unsigned char>(Bytes[0]) == 0xFF &&
        static_cast<unsigned char>(Bytes[1]) == 0xFE)
    {
        for (std::size_t Offset = 2; Offset + 1 < Bytes.size(); Offset += 2)
        {
            const auto Low = static_cast<unsigned char>(Bytes[Offset]);
            const auto High = static_cast<unsigned char>(Bytes[Offset + 1]);
            const wchar_t Character = static_cast<wchar_t>(Low | (static_cast<unsigned int>(High) << 8));
            if (Character == L'\r' || Character == L'\n')
            {
                break;
            }
            Line.push_back(Character);
        }
    }
    else
    {
        const std::size_t End = Bytes.find_first_of("\r\n");
        std::string FirstLine = Bytes.substr(0, End);
        if (FirstLine.size() >= 3 && static_cast<unsigned char>(FirstLine[0]) == 0xEF &&
            static_cast<unsigned char>(FirstLine[1]) == 0xBB && static_cast<unsigned char>(FirstLine[2]) == 0xBF)
        {
            FirstLine.erase(0, 3);
        }

        if (!DecodeText(FirstLine, CP_UTF8, MB_ERR_INVALID_CHARS, Line) && !DecodeText(FirstLine, CP_ACP, 0, Line))
        {
            Failure = L"The first line of Path.txt is not valid text.";
            return false;
        }
    }

    Directory = TrimPathLine(std::move(Line));
    if (Directory.empty())
    {
        Failure = L"The first line of Path.txt is empty.";
        return false;
    }
    return true;
}

bool IsRegularFile(const fs::path& Path)
{
    std::error_code Error;
    return fs::is_regular_file(Path, Error) && !Error;
}

bool IsDirectory(const fs::path& Path)
{
    std::error_code Error;
    return fs::is_directory(Path, Error) && !Error;
}

struct ModuleProbe
{
    bool SnapshotSucceeded = false;
    bool Found = false;
    DWORD Error = ERROR_SUCCESS;
};

ModuleProbe ProbeProcessModule(DWORD ProcessId, const wchar_t* TargetModuleName)
{
    ModuleProbe Result;
    for (int Attempt = 0; Attempt < 4; ++Attempt)
    {
        UniqueHandle Snapshot(CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, ProcessId));
        if (!Snapshot.Valid())
        {
            Result.Error = GetLastError();
            if (Result.Error == ERROR_BAD_LENGTH)
            {
                continue;
            }
            return Result;
        }

        MODULEENTRY32W Entry{};
        Entry.dwSize = sizeof(Entry);
        if (!Module32FirstW(Snapshot.Get(), &Entry))
        {
            Result.Error = GetLastError();
            if (Result.Error == ERROR_BAD_LENGTH)
            {
                continue;
            }
            return Result;
        }

        Result.SnapshotSucceeded = true;
        do {
            if (EqualOrdinalIgnoreCase(Entry.szModule, TargetModuleName))
            {
                Result.Found = true;
                return Result;
            }
            Entry.dwSize = sizeof(Entry);
        } while (Module32NextW(Snapshot.Get(), &Entry));

        const DWORD EnumerationError = GetLastError();
        if (EnumerationError != ERROR_NO_MORE_FILES)
        {
            Result.SnapshotSucceeded = false;
            Result.Error = EnumerationError;
        }
        return Result;
    }

    Result.Error = ERROR_BAD_LENGTH;
    return Result;
}

bool WaitForGameReadiness(HANDLE Process, DWORD ProcessId)
{
    const ULONGLONG Start = GetTickCount64();
    ULONGLONG NextStatus = Start + 5'000;
    DWORD LastProbeError = ERROR_SUCCESS;

    for (;;)
    {
        const DWORD ProcessState = WaitForSingleObject(Process, 0);
        if (ProcessState == WAIT_OBJECT_0)
        {
            DWORD GameExitCode = 0;
            GetExitCodeProcess(Process, &GameExitCode);
            Log(LogLevel::Error, L"NBA2K19 exited before it became ready. Exit code: " + std::to_wstring(GameExitCode));
            return false;
        }
        if (ProcessState == WAIT_FAILED)
        {
            Log(LogLevel::Error, L"Could not query the NBA2K19 process: " + DescribeWindowsError(GetLastError()));
            return false;
        }

        const ModuleProbe Probe = ProbeProcessModule(ProcessId, ReadinessModuleName);
        if (Probe.SnapshotSucceeded && Probe.Found)
        {
            const ULONGLONG Elapsed = GetTickCount64() - Start;
            Log(LogLevel::Info, L"NBA2K19 is ready for injection after " + std::to_wstring(Elapsed) + L" ms.");
            return true;
        }
        LastProbeError = Probe.Error;

        const ULONGLONG Now = GetTickCount64();
        if (Now - Start >= ReadinessTimeoutMs)
        {
            std::wstring Detail = L"NBA2K19 did not expose its loader within " +
                                  std::to_wstring(ReadinessTimeoutMs / 1'000) + L" seconds.";
            if (LastProbeError != ERROR_SUCCESS)
            {
                Detail += L" Last probe: " + DescribeWindowsError(LastProbeError);
            }
            Log(LogLevel::Error, Detail);
            return false;
        }

        if (Now >= NextStatus)
        {
            Log(LogLevel::Verbose, L"Waiting for NBA2K19 process initialization...");
            NextStatus = Now + 5'000;
        }

        const DWORD WaitResult = WaitForSingleObject(Process, ReadinessPollMs);
        if (WaitResult == WAIT_OBJECT_0)
        {
            continue;
        }
        if (WaitResult == WAIT_FAILED)
        {
            Log(LogLevel::Error, L"Readiness wait failed: " + DescribeWindowsError(GetLastError()));
            return false;
        }
    }
}

bool StartProcess(const fs::path& Executable, const fs::path& WorkingDirectory, const std::wstring& Arguments,
                  UniqueHandle& Process, DWORD& ProcessId, DWORD& Error)
{
    std::wstring CommandLine = L"\"" + Executable.wstring() + L"\"";
    if (!Arguments.empty())
    {
        CommandLine += L" ";
        CommandLine += Arguments;
    }
    if (CommandLine.size() >= 32'767)
    {
        Error = ERROR_FILENAME_EXCED_RANGE;
        return false;
    }

    std::vector<wchar_t> MutableCommandLine(CommandLine.begin(), CommandLine.end());
    MutableCommandLine.push_back(L'\0');

    STARTUPINFOW Startup{};
    Startup.cb = sizeof(Startup);
    PROCESS_INFORMATION Information{};

    if (!CreateProcessW(Executable.c_str(), MutableCommandLine.data(), nullptr, nullptr, FALSE,
                        CREATE_UNICODE_ENVIRONMENT, nullptr, WorkingDirectory.c_str(), &Startup, &Information))
    {
        Error = GetLastError();
        return false;
    }

    UniqueHandle PrimaryThread(Information.hThread);
    Process.Reset(Information.hProcess);
    ProcessId = Information.dwProcessId;
    Error = ERROR_SUCCESS;
    return true;
}
}

int wmain(int argc, wchar_t* argv[])
{
#ifndef _WIN64
    Log(LogLevel::Error, L"Launcher must be built for x64.");
    return static_cast<int>(ExitCode::ValidationError);
#endif

    try
    {
        DWORD Error = ERROR_SUCCESS;
        fs::path LauncherPath;
        if (!GetExecutablePath(LauncherPath, Error))
        {
            Log(LogLevel::Error, L"Could not resolve the launcher path: " + DescribeWindowsError(Error));
            return static_cast<int>(ExitCode::ConfigurationError);
        }

        const fs::path LauncherDirectory = LauncherPath.parent_path();
        const fs::path InjectorPath = LauncherDirectory / InjectorExecutableName;
        const fs::path ModulePath = LauncherDirectory / ModuleName;

        fs::path GameDirectory;
        fs::path GamePath;
        if (argc == 3 && EqualOrdinalIgnoreCase(argv[1], L"--game"))
        {
            GamePath = fs::path(argv[2]).lexically_normal();
            if (GamePath.is_relative())
            {
                Log(LogLevel::Error, L"The --game path must be absolute.");
                return static_cast<int>(ExitCode::ConfigurationError);
            }
            GameDirectory = GamePath.parent_path();
        }
        else if (argc == 1)
        {
            const fs::path PathFile = LauncherDirectory / PathFileName;
            std::wstring ConfiguredDirectory;
            std::wstring PathFailure;
            if (!ReadGameDirectory(PathFile, ConfiguredDirectory, PathFailure))
            {
                Log(LogLevel::Error, PathFailure);
                return static_cast<int>(ExitCode::ConfigurationError);
            }
            GameDirectory = fs::path(ConfiguredDirectory);
            if (GameDirectory.is_relative())
            {
                GameDirectory = LauncherDirectory / GameDirectory;
            }
            GameDirectory = GameDirectory.lexically_normal();
            GamePath = GameDirectory / GameExecutableName;
        }
        else
        {
            Log(LogLevel::Error, L"Usage: Launcher.exe [--game <absolute path to NBA2K19.exe>]");
            return static_cast<int>(ExitCode::ConfigurationError);
        }

        if (!IsDirectory(GameDirectory))
        {
            Log(LogLevel::Error, L"Configured game directory does not exist: " + GameDirectory.wstring());
            return static_cast<int>(ExitCode::ValidationError);
        }
        if (!IsRegularFile(GamePath))
        {
            Log(LogLevel::Error, L"Missing NBA2K19 executable: " + GamePath.wstring());
            return static_cast<int>(ExitCode::ValidationError);
        }
        if (!EqualOrdinalIgnoreCase(GamePath.filename().wstring(), GameExecutableName))
        {
            Log(LogLevel::Error, L"The selected game must be NBA2K19.exe: " + GamePath.wstring());
            return static_cast<int>(ExitCode::ValidationError);
        }
        if (!IsRegularFile(InjectorPath))
        {
            Log(LogLevel::Error, L"Missing Injector.exe beside Launcher.exe: " + InjectorPath.wstring());
            return static_cast<int>(ExitCode::ValidationError);
        }
        if (!IsRegularFile(ModulePath))
        {
            Log(LogLevel::Error, L"Missing Module.dll beside Launcher.exe: " + ModulePath.wstring());
            return static_cast<int>(ExitCode::ValidationError);
        }

        Log(LogLevel::Verbose, L"Game executable: " + GamePath.wstring());
        Log(LogLevel::Verbose, L"Injector executable: " + InjectorPath.wstring());
        Log(LogLevel::Verbose, L"Module: " + ModulePath.wstring());

        PatchSteamAccountId(GameDirectory);

        UniqueHandle GameProcess;
        DWORD GameProcessId = 0;
        if (!StartProcess(GamePath, GameDirectory, L"", GameProcess, GameProcessId, Error))
        {
            Log(LogLevel::Error, L"Could not start NBA2K19: " + DescribeWindowsError(Error));
            return static_cast<int>(ExitCode::GameLaunchError);
        }

        Log(LogLevel::Info, L"Started NBA2K19 with PID " + std::to_wstring(GameProcessId) + L".");
        if (!WaitForGameReadiness(GameProcess.Get(), GameProcessId))
        {
            return static_cast<int>(ExitCode::GameReadinessError);
        }

        UniqueHandle InjectorProcess;
        DWORD InjectorProcessId = 0;
        if (!StartProcess(InjectorPath, LauncherDirectory, std::to_wstring(GameProcessId), InjectorProcess,
                          InjectorProcessId, Error))
        {
            Log(LogLevel::Error, L"Could not start Injector.exe: " + DescribeWindowsError(Error));
            return static_cast<int>(ExitCode::InjectorLaunchError);
        }

        Log(LogLevel::Info, L"Started Injector.exe with PID " + std::to_wstring(InjectorProcessId) + L".");
        const DWORD WaitResult = WaitForSingleObject(InjectorProcess.Get(), INFINITE);
        if (WaitResult != WAIT_OBJECT_0)
        {
            const DWORD WaitError = WaitResult == WAIT_FAILED ? GetLastError() : ERROR_GEN_FAILURE;
            Log(LogLevel::Error, L"Could not wait for Injector.exe: " + DescribeWindowsError(WaitError));
            return static_cast<int>(ExitCode::InjectorWaitError);
        }

        DWORD InjectorExitCode = 0;
        if (!GetExitCodeProcess(InjectorProcess.Get(), &InjectorExitCode))
        {
            Log(LogLevel::Error, L"Could not read Injector.exe exit code: " + DescribeWindowsError(GetLastError()));
            return static_cast<int>(ExitCode::InjectorWaitError);
        }

        if (InjectorExitCode != 0)
        {
            Log(LogLevel::Error, L"Injector.exe failed with exit code " + std::to_wstring(InjectorExitCode) + L".");
        }
        else
        {
            Log(LogLevel::Info, L"NBA2K19 module injection completed successfully.");
        }

        return static_cast<int>(InjectorExitCode);
    }
    catch (const std::exception& Exception)
    {
        std::wstring Message;
        if (!DecodeText(Exception.what(), CP_UTF8, 0, Message))
        {
            Message = L"Unspecified C++ exception.";
        }
        Log(LogLevel::Error, L"Unexpected launcher failure: " + Message);
        return static_cast<int>(ExitCode::UnexpectedError);
    }
    catch (...)
    {
        Log(LogLevel::Error, L"Unexpected launcher failure.");
        return static_cast<int>(ExitCode::UnexpectedError);
    }
}
