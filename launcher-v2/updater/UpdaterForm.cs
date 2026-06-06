using System.Drawing;
using System.Windows.Forms;

namespace HealingCamp.Updater;

internal sealed class UpdaterForm : Form
{
    private readonly UpdaterOptions options;
    private readonly Label titleLabel = new();
    private readonly Label detailLabel = new();
    private readonly ProgressBar progressBar = new();

    public UpdaterForm(UpdaterOptions options)
    {
        this.options = options;
        Text = "HealingCamp";
        Width = 520;
        Height = 220;
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(22, 24, 27);

        titleLabel.Left = 28;
        titleLabel.Top = 28;
        titleLabel.Width = 450;
        titleLabel.Height = 34;
        titleLabel.ForeColor = Color.White;
        titleLabel.Font = new Font("Segoe UI", 16, FontStyle.Bold);

        detailLabel.Left = 30;
        detailLabel.Top = 72;
        detailLabel.Width = 440;
        detailLabel.Height = 42;
        detailLabel.ForeColor = Color.FromArgb(180, 188, 200);
        detailLabel.Font = new Font("Segoe UI", 10);

        progressBar.Left = 30;
        progressBar.Top = 130;
        progressBar.Width = 440;
        progressBar.Height = 18;
        progressBar.Minimum = 0;
        progressBar.Maximum = 100;

        Controls.Add(titleLabel);
        Controls.Add(detailLabel);
        Controls.Add(progressBar);

        Shown += async (_, _) => await RunUpdaterAsync();
    }

    private async Task RunUpdaterAsync()
    {
        try
        {
            var progress = new Progress<UpdaterProgress>(UpdateProgress);
            await new LauncherUpdater(options).RunAsync(progress, CancellationToken.None);
            Close();
        }
        catch (Exception error)
        {
            UpdateProgress(new UpdaterProgress("업데이트 실패", error.Message, 100));
            MessageBox.Show(this, error.Message, "HealingCamp Updater", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    private void UpdateProgress(UpdaterProgress progress)
    {
        titleLabel.Text = progress.Title;
        detailLabel.Text = progress.Detail;
        progressBar.Value = Math.Max(progressBar.Minimum, Math.Min(progressBar.Maximum, progress.Percent));
    }
}
