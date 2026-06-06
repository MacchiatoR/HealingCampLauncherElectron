using System.Windows.Forms;

namespace HealingCamp.Updater;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        try
        {
            ApplicationConfiguration.Initialize();
            Application.Run(new UpdaterForm(UpdaterOptions.Parse(args)));
        }
        catch (Exception error)
        {
            MessageBox.Show(
                error.ToString(),
                "HealingCamp Launcher",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        }
    }
}
