export function App() {
  return (
    <main className="landingPage landingPageVersionB">
      <section className="versionBHero" aria-labelledby="landing-title">
        <div className="versionBHeroCopy">
          <p className="versionBEyebrow">TikZ Editor</p>
          <h1 id="landing-title">A new landing page starts here.</h1>
          <p>
            Version A is archived under <code>src/versions/VersionA</code>. This Version B
            entrypoint is intentionally minimal so the next design can be built without
            carrying the old page structure forward.
          </p>
        </div>
      </section>
    </main>
  );
}
