$ErrorActionPreference = "Stop"

$root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$source = Join-Path $root "launcher\CapriPetLauncher.cs"
$icon = Join-Path $root "assets\tray\mojie.ico"
$launcher = Join-Path $root "CapriPetLauncher.exe"

if (-not (Test-Path -LiteralPath $csc)) {
  throw "csc.exe was not found."
}
if (-not (Test-Path -LiteralPath $source)) {
  throw "Launcher source was not found: $source"
}
if (-not (Test-Path -LiteralPath $icon)) {
  throw "Icon file was not found: $icon"
}

& $csc /nologo /codepage:65001 /target:winexe /platform:anycpu /optimize+ "/win32icon:$icon" "/out:$launcher" $source
if ($LASTEXITCODE -ne 0) {
  throw "Launcher compilation failed with exit code $LASTEXITCODE"
}

$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutName = -join @(0x6469, 0x7FAF, 0x684C, 0x5BA0 | ForEach-Object { [char]$_ })
$shortcutDescription = -join @(0x542F, 0x52A8, 0x6469, 0x7FAF, 0x684C, 0x5BA0 | ForEach-Object { [char]$_ })
$shortcutPath = Join-Path $desktop ($shortcutName + ".lnk")
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcher
$shortcut.WorkingDirectory = $root
$shortcut.Description = $shortcutDescription
$shortcut.IconLocation = "$launcher,0"
$shortcut.WindowStyle = 1
$shortcut.Save()

[PSCustomObject]@{
  Launcher = $launcher
  Shortcut = $shortcutPath
  Exists = Test-Path -LiteralPath $shortcutPath
} | Format-List
