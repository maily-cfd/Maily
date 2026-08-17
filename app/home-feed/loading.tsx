// Route-level loading UI for /home-feed. Shown while the server renders the
// page (the force-dynamic layout runs the paywall check, then the page
// streams). bg-boult-bg matches the app ground in both light and dark themes,
// so navigating in shows an app-colored screen — never a black flash.
export default function HomeFeedLoading() {
  return (
    <div className="w-full bg-boult-bg flex items-center justify-center" style={{ height: '100dvh' }}>
      <div className="h-7 w-7 rounded-full border-2 border-neutral-500/25 border-t-neutral-500 animate-spin" />
    </div>
  );
}
