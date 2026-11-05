export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Left: form panel — 1/3 */}
      <div className="w-1/3 flex-shrink-0 flex items-center justify-center bg-white overflow-y-auto py-12">
        <div className="w-full max-w-[340px] px-8">{children}</div>
      </div>

      {/* Right: visual panel — 2/3 */}
      <div
        className="flex-1 relative overflow-hidden"
        style={{ backgroundColor: "#1A154A" }}
      >
        {/* Radial center glow */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 65% 55% at 50% 52%, #2A2175 0%, #1A154A 100%)",
          }}
        />

        {/* Main panel content */}
        <div
          className="absolute inset-0 flex flex-col items-center justify-center px-16 z-10"
        >

          {/* Headline */}
          <h1
            style={{
              color: "#F3F2FF",
              fontSize: "3rem",
              fontWeight: 700,
              lineHeight: 1.18,
              textAlign: "center",
              maxWidth: "480px",
              letterSpacing: "-0.025em",
              margin: 0,
            }}
          >
            AI support for your inquiry process.
          </h1>

          {/* Subheadline */}
          <p
            style={{
              color: "rgba(243,242,255,0.50)",
              fontSize: "0.9375rem",
              fontWeight: 400,
              textAlign: "center",
              maxWidth: "360px",
              marginTop: "18px",
              lineHeight: 1.65,
            }}
          >
            Collaborate with AI agents to understand problems, elicit
            requirements, and structure them.
          </p>

          {/* Role chips */}
          <div className="flex items-center gap-2 mt-9">
            {["Analyst", "Reviewer", "Explorer"].map((agent) => (
              <span
                key={agent}
                style={{
                  padding: "5px 14px",
                  borderRadius: "999px",
                  fontSize: "0.6875rem",
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  color: "rgba(243,242,255,0.60)",
                  border: "1px solid rgba(243,242,255,0.13)",
                  backgroundColor: "rgba(255,255,255,0.055)",
                }}
              >
                {agent}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
