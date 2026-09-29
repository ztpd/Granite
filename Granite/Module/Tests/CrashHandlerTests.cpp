// Copyright (c) 2026 Celestial
// Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.

#include "../CrashHandler.h"

#include <werapi.h>

#include <cstdio>
#include <stdexcept>
#include <string>

#pragma comment(lib, "MinHook/lib/libMinHook.x64.lib")
#pragma comment(lib, "dbghelp.lib")
#pragma comment(lib, "wer.lib")

namespace
{
std::wstring Here()
{
    wchar_t Path[MAX_PATH]{};
    GetModuleFileNameW(nullptr, Path, MAX_PATH);
    std::wstring Full(Path);
    return Full.substr(0, Full.find_last_of(L'\\'));
}

std::wstring WatcherDirectory()
{
    return Here() + L"\\watcher";
}
std::wstring ReportDirectory()
{
    return WatcherDirectory() + L"\\console logs";
}

void Sink(const wchar_t* Text)
{
    wprintf(L"  child> %s\n", Text);
    CrashHandler::RecordLogLine(Text, wcslen(Text));
}

LONG WINAPI GameLikeFilter(EXCEPTION_POINTERS*)
{
    const std::wstring Marker =
        ReportDirectory() + L"\\game-filter-ran-" + std::to_wstring(GetCurrentProcessId()) + L".flag";
    HANDLE File = CreateFileW(Marker.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (File != INVALID_HANDLE_VALUE) CloseHandle(File);
    TerminateProcess(GetCurrentProcess(), 0);
    return EXCEPTION_EXECUTE_HANDLER;
}

__declspec(noinline) int Recurse(volatile int Depth)
{
    char Block[4096];
    Block[0] = static_cast<char>(Depth);
    if (Depth >= 0) return Recurse(Depth + 1) + Block[0];
    return Block[0];
}

void HandledAccessViolation()
{
    __try
    {
        volatile int* Pointer = nullptr;
        *Pointer = 7;
    }
    __except (EXCEPTION_EXECUTE_HANDLER)
    {
    }
}

int Child(const std::wstring& Scenario)
{
    SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX);
    WerSetFlags(WER_FAULT_REPORTING_NO_UI);
    if (Scenario == L"gamefilter-before") SetUnhandledExceptionFilter(GameLikeFilter);

    const std::wstring Dll = WatcherDirectory() + L"\\Module.dll";
    const HMODULE Self = LoadLibraryExW(Dll.c_str(), nullptr, DONT_RESOLVE_DLL_REFERENCES);
    if (!Self)
    {
        wprintf(L"  child> could not map %s (%lu)\n", Dll.c_str(), GetLastError());
        return 90;
    }
    const std::wstring Log = ReportDirectory() + L"\\granite-test-" + Scenario + L".log";
    HANDLE LogFile =
        CreateFileW(Log.c_str(), GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, CREATE_ALWAYS, 0, nullptr);
    const char Seed[] = "@ session log line written before the scenario\n";
    DWORD Wrote = 0;
    WriteFile(LogFile, Seed, sizeof(Seed) - 1, &Wrote, nullptr);
    CloseHandle(LogFile);

    CrashHandler::Install(Sink, ReportDirectory().c_str(), Log.c_str(), Self);
    const wchar_t Tail[] = L"@ redirect nba2k19-svc.2ksports.com:21140 -> test (log tail marker)\n";
    CrashHandler::RecordLogLine(Tail, wcslen(Tail));
    Sleep(300);

    if (Scenario == L"gamefilter-after") SetUnhandledExceptionFilter(GameLikeFilter);

    if (Scenario == L"av" || Scenario == L"gamefilter-after" || Scenario == L"gamefilter-before")
    {
        volatile int* Pointer = nullptr;
        *Pointer = 1;
    }
    else if (Scenario == L"stackoverflow")
        return Recurse(0);
    else if (Scenario == L"fastfail")
        __fastfail(FAST_FAIL_FATAL_APP_EXIT);
    else if (Scenario == L"exit0")
        ExitProcess(0);
    else if (Scenario == L"terminate3")
        TerminateProcess(GetCurrentProcess(), 3);
    else if (Scenario == L"cpp")
        throw std::runtime_error("granite test boom");
    else if (Scenario == L"handled-then-exit")
    {
        HandledAccessViolation();
        ExitProcess(0);
    }
    else if (Scenario == L"breakpoint")
        __debugbreak();
    return 91;
}

std::string ReadAll(const std::wstring& Path)
{
    HANDLE File =
        CreateFileW(Path.c_str(), GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_EXISTING, 0, nullptr);
    if (File == INVALID_HANDLE_VALUE) return {};
    LARGE_INTEGER Size{};
    GetFileSizeEx(File, &Size);
    std::string Text(static_cast<size_t>(Size.QuadPart), '\0');
    DWORD Got = 0;
    ReadFile(File, Text.data(), static_cast<DWORD>(Text.size()), &Got, nullptr);
    CloseHandle(File);
    Text.resize(Got);
    return Text;
}

std::wstring FindReport(DWORD Pid, const wchar_t* Kind, const wchar_t* Suffix)
{
    const std::wstring Pattern = ReportDirectory() + L"\\granite-" + Kind + L"-*-" + std::to_wstring(Pid) + Suffix;
    WIN32_FIND_DATAW Data{};
    HANDLE Find = FindFirstFileW(Pattern.c_str(), &Data);
    if (Find == INVALID_HANDLE_VALUE) return {};
    std::wstring Name = Data.cFileName;
    FindClose(Find);
    return ReportDirectory() + L"\\" + Name;
}

int Failures = 0;

void Check(bool Condition, const std::wstring& Scenario, const char* What)
{
    wprintf(L"  %s %s: %S\n", Condition ? L"PASS" : L"FAIL", Scenario.c_str(), What);
    if (!Condition) ++Failures;
}

bool Contains(const std::string& Text, const char* Needle)
{
    return Text.find(Needle) != std::string::npos;
}

std::string WaitForWatcher(const std::wstring& Path, const char* Marker)
{
    std::string Text;
    for (int I = 0; I < 100; ++I)
    {
        Text = ReadAll(Path);
        if (Contains(Text, Marker)) break;
        Sleep(200);
    }
    return Text;
}

void Run(const std::wstring& Scenario)
{
    wprintf(L"\n== %s ==\n", Scenario.c_str());
    wchar_t Exe[MAX_PATH]{};
    GetModuleFileNameW(nullptr, Exe, MAX_PATH);
    std::wstring Command = L"\"" + std::wstring(Exe) + L"\" " + Scenario;
    STARTUPINFOW Startup{};
    Startup.cb = sizeof(Startup);
    PROCESS_INFORMATION Process{};
    if (!CreateProcessW(Exe, Command.data(), nullptr, nullptr, FALSE, 0, nullptr, nullptr, &Startup, &Process))
    {
        Check(false, Scenario, "child started");
        return;
    }
    CloseHandle(Process.hThread);
    if (WaitForSingleObject(Process.hProcess, 60000) != WAIT_OBJECT_0)
    {
        TerminateProcess(Process.hProcess, 99);
        Check(false, Scenario, "child ended within 60 s");
    }
    DWORD Code = 0;
    GetExitCodeProcess(Process.hProcess, &Code);
    CloseHandle(Process.hProcess);
    const DWORD Pid = Process.dwProcessId;
    wprintf(L"  child pid %lu exit code 0x%08lX\n", Pid, Code);

    char ExitLine[96];
    sprintf_s(ExitLine, "with exit code 0x%08lX", Code);

    if (Scenario == L"fastfail")
    {
        std::wstring External;
        for (int I = 0; I < 100 && External.empty(); ++I)
        {
            External = FindReport(Pid, L"crash", L"-external.txt");
            Sleep(200);
        }
        const std::string Text = ReadAll(External);
        Check(Code == 0xC0000409, Scenario, "process ended with 0xC0000409");
        Check(!External.empty(), Scenario, "watcher wrote the external report");
        Check(Contains(Text, "0xC0000409") && Contains(Text, "fail-fast"), Scenario,
              "external report decodes the fail-fast code");
        Check(Contains(Text, "session log line written before the scenario"), Scenario,
              "external report carries the session log tail");
        Check(Contains(ReadAll(ReportDirectory() + L"\\granite-test-fastfail.log"), "[crash-watcher] process"),
              Scenario, "watcher appended the exit line to the session log");
        return;
    }

    if (Scenario == L"exit0")
    {
        const std::wstring Report = FindReport(Pid, L"exit", L".txt");
        const std::string Text = WaitForWatcher(Report, "Exit watcher");
        Check(!Report.empty(), Scenario, "exit record written");
        Check(Contains(Text, "ExitProcess / RtlExitUserProcess"), Scenario, "trigger is ExitProcess");
        Check(Contains(Text, "Requested by:") && Contains(Text, "CrashHandlerTests.exe+"), Scenario,
              "caller resolved to a module");
        Check(FindReport(Pid, L"crash", L".txt").empty(), Scenario, "no crash report for a clean exit");
        Check(Contains(Text, ExitLine), Scenario, "watcher appended the exit code");
        return;
    }

    const std::wstring Report = FindReport(Pid, L"crash", L".txt");
    const std::string Text = WaitForWatcher(Report, "Exit watcher");
    Check(!Report.empty(), Scenario, "crash report written");
    Check(Contains(Text, "Call stack of the faulting thread") && Contains(Text, "CrashHandlerTests.exe+"), Scenario,
          "call stack resolves into the crashing module");
    Check(Contains(Text, "log tail marker"), Scenario, "Granite log tail included");
    Check(Contains(Text, "Minidump ==") && Contains(Text, ": written"), Scenario, "minidump written");
    Check(Contains(Text, "Exit watcher") && Contains(Text, ExitLine), Scenario, "watcher appended the final exit code");

    if (Scenario == L"av")
    {
        Check(Contains(Text, "EXCEPTION_ACCESS_VIOLATION"), Scenario, "exception named");
        Check(Contains(Text, "attempted to WRITE to 0x0000000000000000"), Scenario,
              "access violation operation and target decoded");
    }
    else if (Scenario == L"gamefilter-after" || Scenario == L"gamefilter-before")
    {
        Check(Contains(Text, "unhandled exception (top-level filter)"), Scenario, "reported before the game filter");
        const std::wstring Flag = ReportDirectory() + L"\\game-filter-ran-" + std::to_wstring(Pid) + L".flag";
        Check(GetFileAttributesW(Flag.c_str()) != INVALID_FILE_ATTRIBUTES, Scenario,
              "game-style filter still ran (chained)");
        Check(Code == 0, Scenario, "game-style filter's TerminateProcess(0) exit code preserved");
        if (Scenario == L"gamefilter-after")
            Check(Contains(Text, "[crash] SetUnhandledExceptionFilter("), Scenario,
                  "late SetUnhandledExceptionFilter was intercepted");
    }
    else if (Scenario == L"stackoverflow")
    {
        Check(Contains(Text, "EXCEPTION_STACK_OVERFLOW"), Scenario, "stack overflow reported from the writer thread");
    }
    else if (Scenario == L"terminate3")
    {
        Check(Contains(Text, "TerminateProcess on this process") && Contains(Text, "Exit code:         0x00000003"),
              Scenario, "abnormal TerminateProcess reported with its code");
    }
    else if (Scenario == L"cpp")
    {
        Check(Contains(Text, ".?AVruntime_error@std@@"), Scenario, "thrown C++ type decoded");
        Check(Contains(Text, "granite test boom"), Scenario, "std::exception::what() recovered");
    }
    else if (Scenario == L"handled-then-exit")
    {
        Check(Contains(Text, "ExitProcess / RtlExitUserProcess"), Scenario,
              "exit after a recent fault gets the full report");
        Check(Contains(Text, "code 0xC0000005 EXCEPTION_ACCESS_VIOLATION") && Contains(Text, "(write 0x0)"), Scenario,
              "handled first-chance fault listed");
    }
    else if (Scenario == L"breakpoint")
    {
        Check(Contains(Text, "EXCEPTION_BREAKPOINT"), Scenario, "breakpoint reported");
    }
}
}

int wmain(int argc, wchar_t** argv)
{
    if (argc > 1) return Child(argv[1]);

    const std::wstring Release = Here() + L"\\..\\Release\\Module.dll";
    CreateDirectoryW(WatcherDirectory().c_str(), nullptr);
    CreateDirectoryW(ReportDirectory().c_str(), nullptr);
    if (!CopyFileW(Release.c_str(), (WatcherDirectory() + L"\\Module.dll").c_str(), FALSE))
    {
        wprintf(L"could not copy %s (%lu)\n", Release.c_str(), GetLastError());
        return 2;
    }
    WIN32_FIND_DATAW Data{};
    HANDLE Find = FindFirstFileW((ReportDirectory() + L"\\*").c_str(), &Data);
    if (Find != INVALID_HANDLE_VALUE)
    {
        do
            if (!(Data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY))
                DeleteFileW((ReportDirectory() + L"\\" + Data.cFileName).c_str());
        while (FindNextFileW(Find, &Data));
        FindClose(Find);
    }

    for (const wchar_t* Scenario : {L"av", L"gamefilter-after", L"gamefilter-before", L"stackoverflow", L"fastfail",
                                    L"exit0", L"terminate3", L"cpp", L"handled-then-exit", L"breakpoint"})
        Run(Scenario);

    wprintf(L"\n%d failure(s)\n", Failures);
    return Failures;
}
