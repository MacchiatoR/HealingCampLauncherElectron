using System.ComponentModel;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows.Forms;

namespace HealingCamp.Updater;

internal sealed class UpdaterForm : Form
{
    private readonly UpdaterOptions options;
    private readonly Label brandLabel = new();
    private readonly Label titleLabel = new();
    private readonly Label detailLabel = new();
    private readonly Label percentLabel = new();
    private readonly PictureBox iconBox = new();
    private readonly ProgressView progressBar = new();

    public UpdaterForm(UpdaterOptions options)
    {
        this.options = options;
        Text = "HealingCamp Launcher";
        Width = 540;
        Height = 320;
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(22, 24, 27);
        ForeColor = Color.White;
        Font = new Font("Segoe UI", 10, FontStyle.Regular);

        var extractedIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        if (extractedIcon is not null)
        {
            Icon = extractedIcon;
            iconBox.Image = extractedIcon.ToBitmap();
        }

        iconBox.Left = 42;
        iconBox.Top = 34;
        iconBox.Width = 64;
        iconBox.Height = 64;
        iconBox.SizeMode = PictureBoxSizeMode.Zoom;

        brandLabel.Left = 124;
        brandLabel.Top = 34;
        brandLabel.Width = 350;
        brandLabel.Height = 32;
        brandLabel.Text = "HealingCamp Launcher";
        brandLabel.ForeColor = Color.FromArgb(245, 247, 251);
        brandLabel.Font = new Font("Segoe UI", 17, FontStyle.Bold);

        titleLabel.Left = 126;
        titleLabel.Top = 69;
        titleLabel.Width = 340;
        titleLabel.Height = 28;
        titleLabel.ForeColor = Color.FromArgb(119, 210, 180);
        titleLabel.Font = new Font("Segoe UI", 11, FontStyle.Bold);

        detailLabel.Left = 42;
        detailLabel.Top = 128;
        detailLabel.Width = 454;
        detailLabel.Height = 46;
        detailLabel.ForeColor = Color.FromArgb(180, 188, 200);
        detailLabel.Font = new Font("Segoe UI", 10, FontStyle.Regular);

        progressBar.Left = 42;
        progressBar.Top = 198;
        progressBar.Width = 454;
        progressBar.Height = 12;
        progressBar.Minimum = 0;
        progressBar.Maximum = 100;

        percentLabel.Left = 42;
        percentLabel.Top = 224;
        percentLabel.Width = 454;
        percentLabel.Height = 24;
        percentLabel.TextAlign = ContentAlignment.MiddleRight;
        percentLabel.ForeColor = Color.FromArgb(119, 210, 180);
        percentLabel.Font = new Font("Segoe UI", 10, FontStyle.Bold);

        Controls.Add(iconBox);
        Controls.Add(brandLabel);
        Controls.Add(titleLabel);
        Controls.Add(detailLabel);
        Controls.Add(progressBar);
        Controls.Add(percentLabel);

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
        progressBar.Value = progress.Percent;
        percentLabel.Text = $"{Math.Max(progressBar.Minimum, Math.Min(progressBar.Maximum, progress.Percent))}%";
    }

    private sealed class ProgressView : Control
    {
        private int value;

        [Browsable(false)]
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
        public int Minimum { get; set; }

        [Browsable(false)]
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
        public int Maximum { get; set; } = 100;

        [Browsable(false)]
        [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
        public int Value
        {
            get => value;
            set
            {
                this.value = Math.Max(Minimum, Math.Min(Maximum, value));
                Invalidate();
            }
        }

        public ProgressView()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint, true);
            BackColor = Color.FromArgb(22, 24, 27);
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            base.OnPaint(e);
            e.Graphics.SmoothingMode = SmoothingMode.AntiAlias;

            using var trackBrush = new SolidBrush(Color.FromArgb(48, 255, 255, 255));
            using var fillBrush = new SolidBrush(Color.FromArgb(119, 210, 180));
            var radius = Height / 2f;
            var track = new RectangleF(0, 0, Width - 1, Height - 1);
            using var trackPath = RoundedRect(track, radius);
            e.Graphics.FillPath(trackBrush, trackPath);

            var range = Math.Max(Maximum - Minimum, 1);
            var fillWidth = (Width - 1) * (Value - Minimum) / (float)range;
            if (fillWidth <= 0)
            {
                return;
            }

            var fill = new RectangleF(0, 0, fillWidth, Height - 1);
            using var fillPath = RoundedRect(fill, radius);
            e.Graphics.FillPath(fillBrush, fillPath);
        }

        private static GraphicsPath RoundedRect(RectangleF bounds, float radius)
        {
            var diameter = radius * 2;
            var path = new GraphicsPath();
            path.AddArc(bounds.X, bounds.Y, diameter, diameter, 180, 90);
            path.AddArc(bounds.Right - diameter, bounds.Y, diameter, diameter, 270, 90);
            path.AddArc(bounds.Right - diameter, bounds.Bottom - diameter, diameter, diameter, 0, 90);
            path.AddArc(bounds.X, bounds.Bottom - diameter, diameter, diameter, 90, 90);
            path.CloseFigure();
            return path;
        }
    }
}
