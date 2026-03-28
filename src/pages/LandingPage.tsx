import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Package, ArrowRight, LogIn, PhoneCall, Zap, ClipboardList,
  Truck, BarChart3, Users, CheckCircle2, TrendingUp, Clock,
  DollarSign, ChevronRight, Star, Shield, Layers
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

/* ─── Fade-in-on-scroll hook ─── */
function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, visible };
}

function Section({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const { ref, visible } = useInView();
  return (
    <section
      ref={ref}
      className={`transition-all duration-700 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"} ${className}`}
    >
      {children}
    </section>
  );
}

/* ─── Feature cards ─── */
const features = [
  { icon: PhoneCall, title: "Smart Call Center", desc: "Auto-assign orders to agents with priority queues, retry logic, and duplicate detection." },
  { icon: Zap, title: "Automation Flows", desc: "WhatsApp confirmations, scheduled follow-ups, and automatic status updates." },
  { icon: ClipboardList, title: "Order Management", desc: "Full pipeline from import to delivery with real-time status tracking." },
  { icon: Truck, title: "Delivery Tracking", desc: "Monitor shipping statuses, manage returns, and optimize delivery rates." },
  { icon: BarChart3, title: "Performance Dashboard", desc: "Agent rankings, confirmation analytics, and revenue insights at a glance." },
  { icon: Users, title: "Multi-Seller System", desc: "Manage multiple sellers with isolated data, custom rates, and individual invoicing." },
];

const steps = [
  { num: "01", title: "Import Orders", desc: "Connect Google Sheets or add orders manually. Automatic deduplication included." },
  { num: "02", title: "Auto-Assign", desc: "Smart queue assigns orders to available agents with balanced workload distribution." },
  { num: "03", title: "Confirm & Ship", desc: "Agents confirm via call, system triggers shipping labels and delivery tracking." },
  { num: "04", title: "Track & Scale", desc: "Monitor KPIs, optimize rates, and scale operations with data-driven decisions." },
];

const benefits = [
  { icon: TrendingUp, title: "+35% Confirmation Rate", desc: "Smart retries and priority queues maximize successful confirmations." },
  { icon: Clock, title: "4× Faster Operations", desc: "Automation eliminates manual work so your team focuses on selling." },
  { icon: Shield, title: "Zero Lost Orders", desc: "Automatic redistribution ensures every order gets processed." },
  { icon: DollarSign, title: "More Profit Per Order", desc: "Higher delivery rates mean more revenue with the same ad spend." },
];

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* ───── NAVBAR ───── */}
      <nav className="sticky top-0 z-50 border-b border-border/60 bg-background/80 backdrop-blur-lg">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary">
              <Package className="h-5 w-5 text-primary-foreground" />
            </div>
            <span className="text-lg font-bold tracking-tight">COD Manager</span>
          </div>
          <div className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <a href="#how" className="hover:text-foreground transition-colors">How It Works</a>
            <a href="#benefits" className="hover:text-foreground transition-colors">Benefits</a>
          </div>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate("/login")}>
            <LogIn className="h-4 w-4" /> Login
          </Button>
        </div>
      </nav>

      {/* ───── HERO ───── */}
      <section className="relative py-20 sm:py-28 overflow-hidden">
        {/* gradient bg */}
        <div className="absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-background to-accent/30" />
          <div className="absolute top-20 -right-32 h-[420px] w-[420px] rounded-full bg-primary/8 blur-3xl" />
          <div className="absolute -bottom-20 -left-20 h-[320px] w-[320px] rounded-full bg-info/10 blur-3xl" />
        </div>

        <div className="mx-auto max-w-6xl px-4 sm:px-6 text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3.5 py-1 text-xs font-medium text-primary mb-6 animate-fade-in">
            <Star className="h-3.5 w-3.5" /> Built for COD Sellers & Call Centers
          </div>

          <h1 className="mx-auto max-w-3xl text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-[1.1] animate-fade-in">
            Scale Your COD Business{" "}
            <span className="text-primary">Without the Chaos</span>
          </h1>

          <p className="mx-auto mt-5 max-w-xl text-base sm:text-lg text-muted-foreground animate-fade-in">
            Manage orders, automate follow-ups, and boost confirmation rates — all in one powerful system built for COD sellers.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3 animate-fade-in">
            <Button size="lg" className="gap-2 px-7 text-base" onClick={() => navigate("/login")}>
              Start Now <ArrowRight className="h-4 w-4" />
            </Button>
            <Button size="lg" variant="outline" className="gap-2 px-7 text-base" onClick={() => navigate("/login")}>
              <LogIn className="h-4 w-4" /> Login
            </Button>
          </div>

          {/* Dashboard mockup */}
          <div className="mx-auto mt-14 max-w-4xl animate-fade-in">
            <div className="rounded-xl border border-border/60 bg-card shadow-2xl shadow-primary/5 p-1.5">
              <div className="rounded-lg bg-muted/50 p-6 sm:p-10">
                <div className="grid grid-cols-4 gap-3 mb-6">
                  {["Total Orders", "Confirmed", "Delivered", "Revenue"].map((label, i) => (
                    <div key={i} className="rounded-lg bg-background border border-border p-3 text-center">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="mt-1 text-lg font-bold text-foreground">
                        {["1,248", "892", "756", "€24.5K"][i]}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {[...Array(3)].map((_, i) => (
                    <div key={i} className="h-24 rounded-lg bg-background border border-border" />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ───── PROBLEM → SOLUTION ───── */}
      <Section className="py-20 bg-muted/30">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
                COD is Profitable…{" "}
                <span className="text-destructive">But Messy.</span>
              </h2>
              <ul className="mt-6 space-y-3">
                {[
                  "Orders scattered across spreadsheets",
                  "Agents wasting time on wrong leads",
                  "Low confirmation rates killing margins",
                  "Missed follow-ups = lost revenue",
                ].map((pain, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-muted-foreground">
                    <span className="mt-1.5 h-2 w-2 rounded-full bg-destructive/70 shrink-0" />
                    {pain}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-8">
              <h3 className="text-2xl font-bold text-primary">We Turn Chaos Into a System.</h3>
              <ul className="mt-5 space-y-3">
                {[
                  { icon: Layers, text: "Smart queue system with auto-assignment" },
                  { icon: Zap, text: "WhatsApp automation flows" },
                  { icon: ClipboardList, text: "Structured confirmation pipeline" },
                  { icon: BarChart3, text: "Real-time performance tracking" },
                ].map(({ icon: Icon, text }, i) => (
                  <li key={i} className="flex items-center gap-2.5">
                    <Icon className="h-4.5 w-4.5 text-primary shrink-0" />
                    <span className="text-foreground font-medium">{text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </Section>

      {/* ───── FEATURES ───── */}
      <Section className="py-20" id="features">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Everything You Need to Run COD —{" "}
            <span className="text-primary">In One Place</span>
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-muted-foreground">
            A complete platform designed specifically for COD e-commerce operations.
          </p>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {features.map(({ icon: Icon, title, desc }, i) => (
              <div
                key={i}
                className="group rounded-xl border border-border bg-card p-6 text-left transition-all duration-300 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-1 hover:border-primary/30"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-base font-semibold">{title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ───── HOW IT WORKS ───── */}
      <Section className="py-20 bg-muted/30" id="how">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            From Order to Delivery —{" "}
            <span className="text-primary">Fully Optimized</span>
          </h2>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {steps.map(({ num, title, desc }, i) => (
              <div key={i} className="relative text-left">
                <span className="text-5xl font-black text-primary/10">{num}</span>
                <h3 className="mt-1 text-base font-semibold">{title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">{desc}</p>
                {i < steps.length - 1 && (
                  <ChevronRight className="hidden lg:block absolute -right-3 top-6 h-5 w-5 text-primary/30" />
                )}
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ───── BENEFITS ───── */}
      <Section className="py-20" id="benefits">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Built to Increase{" "}
            <span className="text-primary">What Matters</span>
          </h2>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {benefits.map(({ icon: Icon, title, desc }, i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-6 text-center transition-all duration-300 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-1">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-4 text-lg font-bold">{title}</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* ───── FINAL CTA ───── */}
      <Section className="py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="rounded-2xl bg-gradient-to-br from-primary to-primary/80 p-10 sm:p-16 text-center text-primary-foreground">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">
              Stop Losing Orders. Start Scaling Smarter.
            </h2>
            <p className="mx-auto mt-4 max-w-md text-primary-foreground/80">
              Join the COD sellers who automated their operations and increased profits.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
              <Button
                size="lg"
                className="gap-2 px-8 text-base bg-background text-foreground hover:bg-background/90"
                onClick={() => navigate("/login")}
              >
                Start Now <ArrowRight className="h-4 w-4" />
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="gap-2 px-8 text-base border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10"
                onClick={() => navigate("/login")}
              >
                <LogIn className="h-4 w-4" /> Login
              </Button>
            </div>
          </div>
        </div>
      </Section>

      {/* ───── FOOTER ───── */}
      <footer className="border-t border-border py-8">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            <span className="font-medium text-foreground">COD Manager</span>
          </div>
          <p>© {new Date().getFullYear()} COD Manager. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
