// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif

#include <windows.h>
#include <winhttp.h>

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <cwctype>
#include <mutex>
#include <string>
#include <unordered_set>

#include "CrashHandler.h"

#pragma comment(lib, "MinHook/lib/libMinHook.x64.lib")

namespace
{
constexpr wchar_t RedirectHost[] = L"127.0.0.1";
constexpr INTERNET_PORT RedirectPort = 21000;

using WinHttpConnectFn = HINTERNET(WINAPI*)(HINTERNET, LPCWSTR, INTERNET_PORT, DWORD);
using WinHttpOpenRequestFn = HINTERNET(WINAPI*)(HINTERNET, LPCWSTR, LPCWSTR, LPCWSTR, LPCWSTR, LPCWSTR const*, DWORD);
using WinHttpSendRequestFn = BOOL(WINAPI*)(HINTERNET, LPCWSTR, DWORD, LPVOID, DWORD, DWORD, DWORD_PTR);
using WinHttpCloseHandleFn = BOOL(WINAPI*)(HINTERNET);

WinHttpConnectFn OriginalConnect = nullptr;
WinHttpOpenRequestFn OriginalOpenRequest = nullptr;
WinHttpSendRequestFn OriginalSendRequest = nullptr;
WinHttpCloseHandleFn OriginalCloseHandle = nullptr;
std::mutex HandlesMutex;
std::unordered_set<HINTERNET> RedirectedConnections;
std::unordered_set<HINTERNET> RedirectedRequests;
std::unordered_set<HINTERNET> LoginRequests;
std::wstring IdentityTicket;
HMODULE SelfModule = nullptr;
std::mutex LogMutex;
HANDLE LogFile = INVALID_HANDLE_VALUE;
wchar_t LogPath[MAX_PATH * 2] = {};

enum class LogLevel
{
    Info,
    Verbose,
    Error
};

void Log(LogLevel Level, const std::wstring& Message)
{
    const wchar_t Symbol = Level == LogLevel::Info ? L'@' : Level == LogLevel::Verbose ? L'~' : L'!';
    const WORD Colour = Level == LogLevel::Info      ? FOREGROUND_GREEN | FOREGROUND_INTENSITY
                        : Level == LogLevel::Verbose ? FOREGROUND_RED | FOREGROUND_GREEN | FOREGROUND_INTENSITY
                                                     : FOREGROUND_RED | FOREGROUND_INTENSITY;
    const std::wstring Line = std::wstring(1, Symbol) + L" " + Message + L"\n";
    OutputDebugStringW(Line.c_str());
    CrashHandler::RecordLogLine(Line.c_str(), Line.size());
    const HANDLE Output = GetStdHandle(Level == LogLevel::Error ? STD_ERROR_HANDLE : STD_OUTPUT_HANDLE);
    if (Output && Output != INVALID_HANDLE_VALUE)
    {
        CONSOLE_SCREEN_BUFFER_INFO Previous{};
        const BOOL HasPrevious = GetConsoleScreenBufferInfo(Output, &Previous);
        SetConsoleTextAttribute(Output, Colour);
        DWORD Written = 0;
        WriteConsoleW(Output, Line.data(), static_cast<DWORD>(Line.size()), &Written, nullptr);
        if (HasPrevious) SetConsoleTextAttribute(Output, Previous.wAttributes);
    }

    std::scoped_lock Lock(LogMutex);
    if (LogFile != INVALID_HANDLE_VALUE)
    {
        const int Bytes =
            WideCharToMultiByte(CP_UTF8, 0, Line.c_str(), static_cast<int>(Line.size()), nullptr, 0, nullptr, nullptr);
        if (Bytes > 0)
        {
            std::string Utf8(static_cast<size_t>(Bytes), '\0');
            WideCharToMultiByte(CP_UTF8, 0, Line.c_str(), static_cast<int>(Line.size()), Utf8.data(), Bytes, nullptr,
                                nullptr);
            DWORD Wrote = 0;
            WriteFile(LogFile, Utf8.data(), static_cast<DWORD>(Utf8.size()), &Wrote, nullptr);
            FlushFileBuffers(LogFile);
        }
    }
}

std::wstring ModuleDirectory()
{
    wchar_t Path[MAX_PATH] = {};
    const DWORD Length = GetModuleFileNameW(SelfModule, Path, MAX_PATH);
    if (Length == 0 || Length >= MAX_PATH) return L".";
    std::wstring Full(Path, Length);
    const size_t Slash = Full.find_last_of(L"\\/");
    return Slash == std::wstring::npos ? L"." : Full.substr(0, Slash);
}

void OpenLogFile()
{
    const std::wstring Directory = ModuleDirectory() + L"\\console logs";
    CreateDirectoryW(Directory.c_str(), nullptr);

    SYSTEMTIME Now{};
    GetLocalTime(&Now);
    wchar_t Name[64] = {};
    swprintf_s(Name, L"\\granite-%04u%02u%02u-%02u%02u%02u.log", Now.wYear, Now.wMonth, Now.wDay, Now.wHour,
               Now.wMinute, Now.wSecond);

    const std::wstring File = Directory + Name;
    wcsncpy_s(LogPath, File.c_str(), _TRUNCATE);
    const HANDLE Handle = CreateFileW(File.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr,
                                      OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (Handle == INVALID_HANDLE_VALUE)
    {
        OutputDebugStringW(L"! Granite could not open a console-logs file\n");
        return;
    }

    LARGE_INTEGER Size{};
    if (GetFileSizeEx(Handle, &Size) && Size.QuadPart == 0)
    {
        const unsigned char Bom[3] = {0xEF, 0xBB, 0xBF};
        DWORD Wrote = 0;
        WriteFile(Handle, Bom, sizeof(Bom), &Wrote, nullptr);
    }

    std::scoped_lock Lock(LogMutex);
    LogFile = Handle;
}

bool EnsureConsole()
{
    if (!GetConsoleWindow() && !AllocConsole())
    {
        OutputDebugStringW(L"! Granite could not allocate a logging console\n");
        return false;
    }

    SetConsoleTitleW(L"Granite NBA2K19 Module");

    FILE* Stream = nullptr;
    if (freopen_s(&Stream, "CONOUT$", "w", stdout) != 0)
        OutputDebugStringW(L"! Granite could not bind stdout to CONOUT$\n");
    if (freopen_s(&Stream, "CONOUT$", "w", stderr) != 0)
        OutputDebugStringW(L"! Granite could not bind stderr to CONOUT$\n");
    if (freopen_s(&Stream, "CONIN$", "r", stdin) != 0)
        OutputDebugStringW(L"~ Granite could not bind stdin to CONIN$\n");
    return true;
}

std::wstring Lower(std::wstring Value)
{
    std::transform(Value.begin(), Value.end(), Value.begin(),
                   [](wchar_t Value) { return static_cast<wchar_t>(std::towlower(Value)); });
    return Value;
}

bool IsTwoKHost(LPCWSTR Host)
{
    if (!Host || !*Host) return false;
    const std::wstring LowerHost = Lower(Host);
    return LowerHost.find(L"2ksports.com") != std::wstring::npos || LowerHost.find(L"2k.com") != std::wstring::npos;
}

bool IsRedirectedConnection(HINTERNET Handle)
{
    std::scoped_lock Lock(HandlesMutex);
    return RedirectedConnections.contains(Handle);
}

bool IsRedirectedRequest(HINTERNET Handle)
{
    std::scoped_lock Lock(HandlesMutex);
    return RedirectedRequests.contains(Handle);
}

HINTERNET WINAPI ConnectHook(HINTERNET Session, LPCWSTR ServerName, INTERNET_PORT Port, DWORD Reserved)
{
    const bool Redirect = IsTwoKHost(ServerName);
    HINTERNET Result =
        OriginalConnect(Session, Redirect ? RedirectHost : ServerName, Redirect ? RedirectPort : Port, Reserved);
    if (Redirect && Result)
    {
        std::scoped_lock Lock(HandlesMutex);
        RedirectedConnections.insert(Result);
    }
    if (Redirect)
    {
        Log(LogLevel::Info, L"redirect " + std::wstring(ServerName) + L":" + std::to_wstring(Port) + L" -> " +
                                RedirectHost + L":" + std::to_wstring(RedirectPort));
    }
    return Result;
}

HINTERNET WINAPI OpenRequestHook(HINTERNET Connection, LPCWSTR Verb, LPCWSTR ObjectName, LPCWSTR Version,
                                 LPCWSTR Referrer, LPCWSTR const* AcceptTypes, DWORD Flags)
{
    HINTERNET Request = OriginalOpenRequest(Connection, Verb, ObjectName, Version, Referrer, AcceptTypes, Flags);
    if (Request && IsRedirectedConnection(Connection))
    {
        std::scoped_lock Lock(HandlesMutex);
        RedirectedRequests.insert(Request);
        const std::wstring Object = Lower(ObjectName ? ObjectName : L"");
        if (Object.find(L"/session/login") != std::wstring::npos) LoginRequests.insert(Request);
    }
    if (IsRedirectedConnection(Connection))
    {
        Log(LogLevel::Verbose, std::wstring(Verb ? Verb : L"GET") + L" " + (ObjectName ? ObjectName : L"/"));
    }
    return Request;
}

BOOL WINAPI SendRequestHook(HINTERNET Request, LPCWSTR Headers, DWORD HeadersLength, LPVOID Optional,
                            DWORD OptionalLength, DWORD TotalLength, DWORD_PTR Context)
{
    if (IsRedirectedRequest(Request))
    {
        DWORD Security = SECURITY_FLAG_IGNORE_UNKNOWN_CA | SECURITY_FLAG_IGNORE_CERT_CN_INVALID |
                         SECURITY_FLAG_IGNORE_CERT_DATE_INVALID | SECURITY_FLAG_IGNORE_CERT_WRONG_USAGE;
        if (!WinHttpSetOption(Request, WINHTTP_OPTION_SECURITY_FLAGS, &Security, sizeof(Security)))
        {
            Log(LogLevel::Error, L"WinHttpSetOption security flags failed: " + std::to_wstring(GetLastError()));
        }
        bool LoginRequest = false;
        {
            std::scoped_lock Lock(HandlesMutex);
            LoginRequest = LoginRequests.contains(Request);
        }
        if (LoginRequest && !IdentityTicket.empty())
        {
            const std::wstring IdentityHeader = L"X-Celestial-Ticket: " + IdentityTicket + L"\r\n";
            if (!WinHttpAddRequestHeaders(Request, IdentityHeader.c_str(), static_cast<DWORD>(IdentityHeader.size()),
                                          WINHTTP_ADDREQ_FLAG_ADD | WINHTTP_ADDREQ_FLAG_REPLACE))
            {
                Log(LogLevel::Error,
                    L"could not attach the Celestial identity ticket: " + std::to_wstring(GetLastError()));
            }
            else
            {
                Log(LogLevel::Verbose, L"attached verified identity to Session/login");
            }
        }
    }
    return OriginalSendRequest(Request, Headers, HeadersLength, Optional, OptionalLength, TotalLength, Context);
}

BOOL WINAPI CloseHandleHook(HINTERNET Handle)
{
    {
        std::scoped_lock Lock(HandlesMutex);
        RedirectedRequests.erase(Handle);
        RedirectedConnections.erase(Handle);
        LoginRequests.erase(Handle);
    }
    return OriginalCloseHandle(Handle);
}

template <typename Function>
bool PatchImport(HMODULE Module, const char* ImportedModule, const char* FunctionName, Function Replacement,
                 Function& Original)
{
    if (!Module) return false;
    auto* Base = reinterpret_cast<unsigned char*>(Module);
    auto* Dos = reinterpret_cast<IMAGE_DOS_HEADER*>(Base);
    if (Dos->e_magic != IMAGE_DOS_SIGNATURE) return false;
    auto* Nt = reinterpret_cast<IMAGE_NT_HEADERS*>(Base + Dos->e_lfanew);
    if (Nt->Signature != IMAGE_NT_SIGNATURE) return false;
    const auto Directory = Nt->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_IMPORT];
    if (!Directory.VirtualAddress || !Directory.Size) return false;

    auto* Descriptor = reinterpret_cast<IMAGE_IMPORT_DESCRIPTOR*>(Base + Directory.VirtualAddress);
    for (; Descriptor->Name; ++Descriptor)
    {
        const char* Name = reinterpret_cast<const char*>(Base + Descriptor->Name);
        if (_stricmp(Name, ImportedModule) != 0) continue;
        auto* Thunk = reinterpret_cast<IMAGE_THUNK_DATA*>(Base + Descriptor->FirstThunk);
        auto* Lookup = Descriptor->OriginalFirstThunk
                           ? reinterpret_cast<IMAGE_THUNK_DATA*>(Base + Descriptor->OriginalFirstThunk)
                           : Thunk;
        for (; Lookup->u1.AddressOfData; ++Lookup, ++Thunk)
        {
            if (IMAGE_SNAP_BY_ORDINAL(Lookup->u1.Ordinal)) continue;
            auto* Import = reinterpret_cast<IMAGE_IMPORT_BY_NAME*>(Base + Lookup->u1.AddressOfData);
            if (std::strcmp(reinterpret_cast<const char*>(Import->Name), FunctionName) != 0) continue;
            auto** Slot = reinterpret_cast<void**>(&Thunk->u1.Function);
            DWORD Protection = 0;
            if (!VirtualProtect(Slot, sizeof(void*), PAGE_READWRITE, &Protection)) return false;
            Original = reinterpret_cast<Function>(*Slot);
            *Slot = reinterpret_cast<void*>(Replacement);
            FlushInstructionCache(GetCurrentProcess(), Slot, sizeof(void*));
            DWORD Ignored = 0;
            VirtualProtect(Slot, sizeof(void*), Protection, &Ignored);
            return Original != nullptr;
        }
    }
    return false;
}

DWORD WINAPI Initialise(void*)
{
    EnsureConsole();
    OpenLogFile();
    Log(LogLevel::Info, L"Granite module log started in the console logs folder");
    CrashHandler::Install([](const wchar_t* Text) { Log(LogLevel::Info, Text); },
                          (ModuleDirectory() + L"\\console logs").c_str(), LogPath, SelfModule);
    DWORD TicketLength = GetEnvironmentVariableW(L"CELESTIAL_IDENTITY_TICKET", nullptr, 0);
    if (TicketLength > 1 && TicketLength < 8192)
    {
        std::wstring Ticket(TicketLength, L'\0');
        const DWORD Copied = GetEnvironmentVariableW(L"CELESTIAL_IDENTITY_TICKET", Ticket.data(), TicketLength);
        if (Copied > 0 && Copied < TicketLength)
        {
            Ticket.resize(Copied);
            IdentityTicket = std::move(Ticket);
            SetEnvironmentVariableW(L"CELESTIAL_IDENTITY_TICKET", nullptr);
            Log(LogLevel::Verbose, L"Celestial identity ticket loaded");
        }
    }
    HMODULE Executable = GetModuleHandleW(nullptr);
    const bool Connect = PatchImport(Executable, "WINHTTP.dll", "WinHttpConnect", ConnectHook, OriginalConnect);
    const bool Open =
        PatchImport(Executable, "WINHTTP.dll", "WinHttpOpenRequest", OpenRequestHook, OriginalOpenRequest);
    const bool Send =
        PatchImport(Executable, "WINHTTP.dll", "WinHttpSendRequest", SendRequestHook, OriginalSendRequest);
    const bool Close =
        PatchImport(Executable, "WINHTTP.dll", "WinHttpCloseHandle", CloseHandleHook, OriginalCloseHandle);

    if (Connect && Open && Send && Close)
    {
        Log(LogLevel::Info,
            L"NBA2K19 WinHTTP redirect active at " + std::wstring(RedirectHost) + L":" + std::to_wstring(RedirectPort));
        return 0;
    }
    Log(LogLevel::Error,
        L"could not install every WinHTTP import hook; this NBA2K19 build may use delay imports or a different transport");
    return 1;
}
}

extern "C" __declspec(dllexport) unsigned int GraniteModuleVersion()
{
    return 0x00010100;
}

extern "C" __declspec(dllexport) void CALLBACK GraniteCrashWatchW(HWND, HINSTANCE, LPWSTR CommandLine, int)
{
    CrashHandler::WatchMain(CommandLine);
}

BOOL APIENTRY DllMain(HMODULE Module, DWORD Reason, LPVOID)
{
    if (Reason == DLL_PROCESS_ATTACH)
    {
        SelfModule = Module;
        DisableThreadLibraryCalls(Module);
        wchar_t Host[MAX_PATH] = {};
        GetModuleFileNameW(nullptr, Host, MAX_PATH);
        const wchar_t* HostName = wcsrchr(Host, L'\\');
        if (_wcsicmp(HostName ? HostName + 1 : Host, L"rundll32.exe") == 0) return TRUE;
        if (HANDLE Thread = CreateThread(nullptr, 0, Initialise, nullptr, 0, nullptr)) CloseHandle(Thread);
    }
    return TRUE;
}
