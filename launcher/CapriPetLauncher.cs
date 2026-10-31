using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

namespace CapriPetLauncher
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            string appDirectory = Path.GetFullPath(
                AppDomain.CurrentDomain.BaseDirectory
            ).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            string electronPath = Path.Combine(
                appDirectory,
                "node_modules",
                "electron",
                "dist",
                "electron.exe"
            );

            if (!File.Exists(electronPath))
            {
                MessageBox.Show(
                    "未找到 Electron 运行时。\n\n请先在项目目录运行 npm install。",
                    "摩羯桌宠",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning
                );
                return;
            }

            ProcessStartInfo startInfo = new ProcessStartInfo
            {
                FileName = electronPath,
                Arguments = "\"" + appDirectory + "\"",
                WorkingDirectory = appDirectory,
                UseShellExecute = true,
                WindowStyle = ProcessWindowStyle.Normal
            };

            try
            {
                Process.Start(startInfo);
            }
            catch (Exception error)
            {
                MessageBox.Show(
                    "桌宠启动失败：\n\n" + error.Message,
                    "摩羯桌宠",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
        }
    }
}
