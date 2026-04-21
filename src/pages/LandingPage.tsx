import { useNavigate } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight, LogIn, PhoneCall, Truck, BarChart3, CheckCircle2,
  Rocket, Headset, Banknote, Globe2, Package, Warehouse, Users,
  TrendingUp, ShieldCheck, Zap, Search, RotateCcw, Boxes,
  Sparkles, MapPin, Clock, Star, Mail, Phone, Activity,
} from "lucide-react";

import heroImg from "@/assets/scalers-hero-banner.png";
import opportunityImg from "@/assets/scalers-opportunity.jpg";
import problemImg from "@/assets/scalers-problem.jpg";
import solutionImg from "@/assets/scalers-solution.jpg";
import servicesImg from "@/assets/scalers-services.jpg";
import whyImg from "@/assets/scalers-why.jpg";
import howImg from "@/assets/scalers-howitworks.jpg";
import systemImg from "@/assets/scalers-system.jpg";
import visionImg from "@/assets/scalers-vision.jpg";
import ctaImg from "@/assets/scalers-cta.jpg";

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

function Reveal({ children, className = "", id, delay = 0 }: { children: React.ReactNode; className?: string; id?: string; delay?: number }) {
  const { ref, visible } = useInView();
  return (
    <section
      ref={ref}
      id={id}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-[900ms] ease-out ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10"} ${className}`}
    >
      {children}
    </section>
  );
}

const opportunityPoints = [
  { icon: Users, title: "240M+ Population", desc: "5th most populous nation — a massive untapped consumer base hungry for new products." },
  { icon: Banknote, title: "COD Dominant", desc: "Cash-on-Delivery rules e-commerce in Pakistan, perfect for high-conversion campaigns." },
  { icon: TrendingUp, title: "Fast Growth", desc: "Double-digit YoY growth in online retail and mobile commerce adoption." },
  { icon: MapPin, title: "Untapped Market", desc: "Fewer competitors, lower CPMs, and white-space categories ready to dominate." },
];

const problemPoints = [
  { icon: Boxes, title: "Complex Logistics", desc: "Customs, warehousing and last-mile delivery without a local partner is a maze." },
  { icon: Truck, title: "Low Delivery Rates", desc: "Wrong addresses, failed attempts and weak couriers eat your margins." },
  { icon: PhoneCall, title: "Weak Confirmation", desc: "Untrained call centers burn leads instead of closing them." },
  { icon: Banknote, title: "Cash Issues", desc: "COD collection delays and reconciliation chaos kill cash flow." },
];

const services = [
  { icon: Search, title: "Product Sourcing", desc: "We find, validate, and price-test winners locally." },
  { icon: PhoneCall, title: "Order Confirmation", desc: "Native-language agents with proven scripts and retry logic." },
  { icon: Warehouse, title: "Fulfillment & Shipping", desc: "Pick, pack, label — fast and accurate." },
  { icon: Truck, title: "Last-Mile Delivery", desc: "Nationwide coverage with top-tier carriers." },
  { icon: Banknote, title: "COD Collection", desc: "Fast, transparent payouts directly to your wallet." },
  { icon: RotateCcw, title: "Free Returns", desc: "We handle reverse logistics — at zero cost to you." },
  { icon: Boxes, title: "Free Storage", desc: "Warehouse your inventory with us. No storage fees. Ever." },
];

const whyPoints = [
  { icon: CheckCircle2, title: "High Confirmation Rate", desc: "Trained, monitored agents converting leads at industry-leading rates." },
  { icon: Truck, title: "High Delivery Rate", desc: "Smart routing, address validation and proactive customer outreach." },
  { icon: TrendingUp, title: "Performance-Based Model", desc: "You only pay when we perform. Our success is tied to yours." },
  { icon: Activity, title: "Real-Time Tracking", desc: "Every order, every status, every dollar — visible 24/7." },
];

const steps = [
  { icon: Rocket, title: "Launch", desc: "Onboard your products and go live in days." },
  { icon: Headset, title: "Confirm", desc: "Our agents qualify and lock in every order." },
  { icon: Truck, title: "Deliver", desc: "We pick, ship and deliver across Pakistan." },
  { icon: Banknote, title: "Get Paid", desc: "COD collected, reconciled, and paid to you." },
];

const systemFeatures = [
  { icon: Package, title: "Order Tracking", desc: "Live status from import to delivery, every step logged." },
  { icon: Banknote, title: "Cash Tracking", desc: "Every PKR accounted for — invoices, payouts, adjustments." },
  { icon: BarChart3, title: "Analytics", desc: "Confirmation, delivery and finance dashboards in one place." },
];

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#040814] text-white antialiased">
      {/* Global ambient blue glow */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -top-40 left-1/2 h-[600px] w-[1100px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(56,128,255,0.35),transparent_70%)] blur-3xl" />
        <div className="absolute top-[40%] -left-40 h-[500px] w-[500px] rounded-full bg-[radial-gradient(closest-side,rgba(37,99,235,0.25),transparent_70%)] blur-3xl" />
        <div className="absolute bottom-0 right-0 h-[600px] w-[600px] rounded-full bg-[radial-gradient(closest-side,rgba(99,179,255,0.18),transparent_70%)] blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(120,170,255,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(120,170,255,0.4) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
            maskImage: "radial-gradient(ellipse at center, black 30%, transparent 80%)",
          }}
        />
      </div>

      {/* ─── NAV ─── */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-[#040814]/70 border-b border-white/5">
        <div className="mx-auto max-w-7xl px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-blue-400 to-blue-700 grid place-items-center shadow-[0_0_30px_rgba(56,128,255,0.6)]">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div className="leading-tight">
              <div className="font-bold text-lg tracking-tight">Scalers</div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-blue-300/70">Scale Beyond Borders</div>
            </div>
          </div>
          <nav className="hidden md:flex items-center gap-8 text-sm text-white/70">
            <a href="#opportunity" className="hover:text-white transition">Opportunity</a>
            <a href="#services" className="hover:text-white transition">Services</a>
            <a href="#how" className="hover:text-white transition">How it works</a>
            <a href="#pricing" className="hover:text-white transition">Pricing</a>
          </nav>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate("/login")}
              className="hidden sm:inline-flex items-center gap-1.5 text-sm text-white/80 hover:text-white px-3 py-2 rounded-lg transition"
            >
              <LogIn className="w-4 h-4" /> Sign in
            </button>
            <a
              href="#cta"
              className="inline-flex items-center gap-1.5 text-sm font-medium px-4 py-2 rounded-lg bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-[0_0_30px_rgba(56,128,255,0.5)] hover:shadow-[0_0_40px_rgba(56,128,255,0.8)] transition"
            >
              Book a Call <ArrowRight className="w-4 h-4" />
            </a>
          </div>
        </div>
      </header>

      {/* ─── 1. HERO ─── */}
      <Reveal id="hero" className="relative">
        <div className="relative w-full">
          <img
            src={heroImg}
            alt="Scalers — Scale Beyond Borders. Launch & scale your COD business in Pakistan."
            width={1536}
            height={1024}
            className="w-screen h-auto block"
          />
        </div>

        <div className="mx-auto max-w-7xl px-4 sm:px-6 pt-8 pb-16 md:pb-24 flex flex-wrap items-center justify-center gap-3">
          <a
            href="#cta"
            className="group inline-flex items-center gap-2 px-7 py-4 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold shadow-[0_0_50px_rgba(56,128,255,0.6)] hover:shadow-[0_0_70px_rgba(56,128,255,0.9)] transition"
          >
            Start Scaling Now
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
          </a>
          <a
            href="#cta"
            className="inline-flex items-center gap-2 px-7 py-4 rounded-xl border border-white/15 bg-white/[0.04] text-white hover:bg-white/[0.08] transition"
          >
            <PhoneCall className="w-4 h-4" /> Book a Call
          </a>
        </div>
      </Reveal>

      {/* ─── 2. OPPORTUNITY ─── */}
      <Reveal id="opportunity" className="relative w-full overflow-hidden">
        {/* Full-bleed background image */}
        <img
          src={opportunityImg}
          alt="Pakistan growth opportunity"
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover"
        />
        {/* Cinematic overlays */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#04060f] via-[#04060f]/40 to-[#04060f]" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#04060f]/90 via-transparent to-[#04060f]/70" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(4,6,15,0.6)_100%)]" />

        {/* Content */}
        <div className="relative mx-auto max-w-7xl px-6 py-28 md:py-36 lg:py-44 min-h-[760px] flex flex-col justify-between gap-16">
          {/* Top: headline */}
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 text-blue-300 text-xs uppercase tracking-[0.25em] font-semibold mb-5">
              <span className="w-8 h-px bg-blue-400/60" />
              The Opportunity
            </div>
            <h2 className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight mb-6 text-white leading-[1.05]">
              Pakistan = Your Next{" "}
              <span className="bg-gradient-to-r from-blue-300 via-blue-400 to-blue-600 bg-clip-text text-transparent">
                Growth Engine
              </span>
            </h2>
            <p className="text-white/75 text-lg md:text-xl leading-relaxed max-w-2xl">
              While everyone fights over saturated markets, Pakistan is wide open — ready, willing and waiting.
            </p>
          </div>

          {/* Bottom: KPI cards anchored */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            {opportunityPoints.map((p) => (
              <div
                key={p.title}
                className="group relative rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-5 md:p-6 hover:border-blue-400/50 hover:bg-white/[0.08] transition-all duration-300 hover:-translate-y-1"
              >
                <div className="w-10 h-10 rounded-lg grid place-items-center bg-blue-500/15 border border-blue-400/30 text-blue-300 mb-3">
                  <p.icon className="w-5 h-5" />
                </div>
                <div className="font-semibold mb-1 text-white text-base md:text-lg">{p.title}</div>
                <div className="text-xs md:text-sm text-white/65 leading-relaxed">{p.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </Reveal>

      {/* ─── 3. PROBLEM ─── */}
      <Reveal className="relative w-full overflow-hidden">
        {/* Full-bleed background image */}
        <img
          src={problemImg}
          alt="Stressed seller in warehouse"
          loading="lazy"
          className="absolute inset-0 w-full h-full object-cover"
        />
        {/* Cinematic overlays */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#04060f] via-[#04060f]/40 to-[#04060f]" />
        <div className="absolute inset-0 bg-gradient-to-l from-[#04060f]/90 via-transparent to-[#04060f]/70" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,rgba(4,6,15,0.6)_100%)]" />

        {/* Content */}
        <div className="relative mx-auto max-w-7xl px-6 py-28 md:py-36 lg:py-44 min-h-[760px] flex flex-col justify-between gap-16">
          {/* Top: headline (right-aligned to balance image subject on left) */}
          <div className="max-w-3xl lg:ml-auto lg:text-right">
            <div className="inline-flex items-center gap-2 text-red-300/90 text-xs uppercase tracking-[0.25em] font-semibold mb-5">
              <span className="w-8 h-px bg-red-400/60" />
              The Problem
            </div>
            <h2 className="text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight mb-6 text-white leading-[1.05]">
              Why Most Sellers{" "}
              <span className="bg-gradient-to-r from-red-300 via-red-400 to-red-500 bg-clip-text text-transparent">
                Fail to Expand
              </span>
            </h2>
            <p className="text-white/75 text-lg md:text-xl leading-relaxed max-w-2xl lg:ml-auto">
              Going cross-border looks easy on a slide deck. In practice, four things kill 9 out of 10 attempts.
            </p>
          </div>

          {/* Bottom: pain-point cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
            {problemPoints.map((p) => (
              <div
                key={p.title}
                className="group relative rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl p-5 md:p-6 hover:border-red-400/40 hover:bg-white/[0.08] transition-all duration-300 hover:-translate-y-1"
              >
                <div className="w-10 h-10 rounded-lg grid place-items-center bg-red-500/15 border border-red-400/30 text-red-300 mb-3">
                  <p.icon className="w-5 h-5" />
                </div>
                <div className="font-semibold mb-1 text-white text-base md:text-lg">{p.title}</div>
                <div className="text-xs md:text-sm text-white/65 leading-relaxed">{p.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </Reveal>

      {/* ─── 4. SOLUTION ─── */}
      <Reveal className="relative py-24 md:py-32">
        <div className="mx-auto max-w-7xl px-6 text-center">
          <div className="text-blue-300 text-xs uppercase tracking-[0.2em] font-semibold mb-4">The Solution</div>
          <h2 className="text-4xl md:text-6xl font-bold tracking-tight mb-5">
            We Handle Everything. <br className="hidden md:block" />
            <span className="bg-gradient-to-r from-blue-300 to-blue-500 bg-clip-text text-transparent">You Scale.</span>
          </h2>
          <p className="text-white/70 text-lg max-w-2xl mx-auto mb-14 leading-relaxed">
            One complete end-to-end e-commerce stack — built specifically for COD-first markets.
          </p>
          <div className="relative max-w-5xl mx-auto">
            <div className="absolute inset-0 -m-8 bg-[radial-gradient(closest-side,rgba(56,128,255,0.4),transparent_70%)] blur-3xl" />
            <div className="relative rounded-3xl overflow-hidden border border-blue-400/20 shadow-[0_0_80px_rgba(56,128,255,0.35)]">
              <img src={solutionImg} alt="System diagram" loading="lazy" width={1280} height={896} className="w-full h-auto" />
            </div>
          </div>
        </div>
      </Reveal>

      {/* ─── 5. SERVICES ─── */}
      <Reveal id="services" className="relative py-24 md:py-32">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <div className="text-blue-300 text-xs uppercase tracking-[0.2em] font-semibold mb-4">What We Do</div>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-5">
              A Full Stack Built for <span className="bg-gradient-to-r from-blue-300 to-blue-500 bg-clip-text text-transparent">COD Sellers</span>
            </h2>
            <p className="text-white/70 text-lg">Every service you need to launch, run and grow — under one roof.</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {services.map((s, i) => (
              <div
                key={s.title}
                className="group relative rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-white/[0.01] p-6 hover:border-blue-400/40 transition overflow-hidden"
              >
                <div className="absolute -top-20 -right-20 w-48 h-48 rounded-full bg-blue-500/10 blur-3xl opacity-0 group-hover:opacity-100 transition" />
                <div className="relative">
                  <div className="w-12 h-12 rounded-xl grid place-items-center bg-gradient-to-br from-blue-500/20 to-blue-700/10 border border-blue-400/30 text-blue-300 mb-4 shadow-[0_0_30px_rgba(56,128,255,0.25)]">
                    <s.icon className="w-6 h-6" />
                  </div>
                  <div className="font-semibold text-lg mb-1.5">{s.title}</div>
                  <div className="text-sm text-white/60 leading-relaxed">{s.desc}</div>
                </div>
                <div className="absolute top-4 right-4 text-[11px] text-white/30 tabular-nums">0{i + 1}</div>
              </div>
            ))}
          </div>
        </div>
      </Reveal>

      {/* ─── 6. WHY SCALERS ─── */}
      <Reveal className="relative py-24 md:py-32">
        <div className="mx-auto max-w-7xl px-6 grid lg:grid-cols-2 gap-16 items-center">
          <div>
            <div className="text-blue-300 text-xs uppercase tracking-[0.2em] font-semibold mb-4">Why Scalers</div>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-5">
              Built to <span className="bg-gradient-to-r from-blue-300 to-blue-500 bg-clip-text text-transparent">Win.</span>
            </h2>
            <p className="text-white/70 text-lg mb-10">Performance is not a metric. It's the contract.</p>
            <div className="space-y-4">
              {whyPoints.map((p) => (
                <div key={p.title} className="flex gap-4 p-4 rounded-2xl border border-white/10 bg-white/[0.03] hover:border-blue-400/40 transition">
                  <div className="w-10 h-10 shrink-0 rounded-lg grid place-items-center bg-blue-500/15 border border-blue-400/30 text-blue-300">
                    <p.icon className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-semibold mb-0.5">{p.title}</div>
                    <div className="text-sm text-white/60">{p.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="relative">
            <div className="absolute inset-0 -m-8 bg-[radial-gradient(closest-side,rgba(56,128,255,0.4),transparent_70%)] blur-3xl" />
            <div className="relative rounded-2xl overflow-hidden border border-blue-400/20 shadow-[0_0_60px_rgba(56,128,255,0.3)]">
              <img src={whyImg} alt="Analytics dashboard" loading="lazy" width={1280} height={896} className="w-full h-auto" />
            </div>
          </div>
        </div>
      </Reveal>

      {/* ─── 7. HOW IT WORKS ─── */}
      <Reveal id="how" className="relative py-24 md:py-32">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <div className="text-blue-300 text-xs uppercase tracking-[0.2em] font-semibold mb-4">How It Works</div>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-5">
              Four Steps. <span className="bg-gradient-to-r from-blue-300 to-blue-500 bg-clip-text text-transparent">Zero Friction.</span>
            </h2>
          </div>

          <div className="relative grid md:grid-cols-4 gap-5">
            <div className="hidden md:block absolute top-12 left-[12%] right-[12%] h-px bg-gradient-to-r from-transparent via-blue-400/40 to-transparent" />
            {steps.map((s, i) => (
              <div key={s.title} className="relative text-center">
                <div className="relative mx-auto w-24 h-24 rounded-2xl grid place-items-center bg-gradient-to-br from-blue-500/20 to-blue-700/10 border border-blue-400/30 shadow-[0_0_40px_rgba(56,128,255,0.35)] mb-5">
                  <s.icon className="w-9 h-9 text-blue-300" />
                  <div className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-blue-500 text-white text-xs font-bold grid place-items-center shadow-[0_0_20px_rgba(56,128,255,0.7)]">
                    {i + 1}
                  </div>
                </div>
                <div className="font-semibold text-lg mb-1.5">{s.title}</div>
                <div className="text-sm text-white/60">{s.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </Reveal>

      {/* ─── 8. SYSTEM ─── */}
      <Reveal className="relative py-24 md:py-32">
        <div className="mx-auto max-w-7xl px-6 grid lg:grid-cols-2 gap-16 items-center">
          <div className="relative order-2 lg:order-1">
            <div className="absolute inset-0 -m-8 bg-[radial-gradient(closest-side,rgba(56,128,255,0.4),transparent_70%)] blur-3xl" />
            <div className="relative rounded-2xl overflow-hidden border border-blue-400/20 shadow-[0_0_60px_rgba(56,128,255,0.3)]">
              <img src={systemImg} alt="Dashboard on devices" loading="lazy" width={1280} height={896} className="w-full h-auto" />
            </div>
          </div>
          <div className="order-1 lg:order-2">
            <div className="text-blue-300 text-xs uppercase tracking-[0.2em] font-semibold mb-4">The System</div>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-5">
              Full Control. <span className="bg-gradient-to-r from-blue-300 to-blue-500 bg-clip-text text-transparent">Real-Time Visibility.</span>
            </h2>
            <p className="text-white/70 text-lg mb-10 leading-relaxed">
              A purpose-built dashboard giving you live order, cash and analytics data — anytime, anywhere.
            </p>
            <div className="space-y-3">
              {systemFeatures.map((f) => (
                <div key={f.title} className="flex items-start gap-4 p-4 rounded-xl border border-white/10 bg-white/[0.03]">
                  <div className="w-9 h-9 shrink-0 rounded-lg grid place-items-center bg-blue-500/15 border border-blue-400/30 text-blue-300">
                    <f.icon className="w-4.5 h-4.5" />
                  </div>
                  <div>
                    <div className="font-semibold">{f.title}</div>
                    <div className="text-sm text-white/60">{f.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Reveal>

      {/* ─── 9. PRICING ─── */}
      <Reveal id="pricing" className="relative py-24 md:py-32">
        <div className="mx-auto max-w-7xl px-6">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <div className="text-blue-300 text-xs uppercase tracking-[0.2em] font-semibold mb-4">Pricing</div>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight mb-5">
              Clear. Simple. <span className="bg-gradient-to-r from-blue-300 to-blue-500 bg-clip-text text-transparent">Transparent.</span>
            </h2>
            <p className="text-white/70 text-lg">No hidden fees. No surprises. You pay for performance.</p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {/* Call Center */}
            <div className="relative rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.01] p-8 hover:border-blue-400/40 transition">
              <div className="w-11 h-11 rounded-xl grid place-items-center bg-blue-500/15 border border-blue-400/30 text-blue-300 mb-5">
                <Headset className="w-5 h-5" />
              </div>
              <div className="text-sm uppercase tracking-wider text-white/50 mb-1">Call Center</div>
              <div className="text-2xl font-bold mb-6">Per-action pricing</div>
              <ul className="space-y-3 text-sm">
                {[
                  ["Lead", "$0.20"],
                  ["Confirmed", "$0.30"],
                  ["Delivered", "FREE"],
                  ["Upsell", "$2.00"],
                ].map(([k, v]) => (
                  <li key={k} className="flex items-center justify-between border-b border-white/5 pb-2.5">
                    <span className="text-white/70">{k}</span>
                    <span className="font-semibold text-blue-300 tabular-nums">{v}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Shipping (featured) */}
            <div className="relative rounded-3xl border border-blue-400/40 bg-gradient-to-b from-blue-500/15 to-blue-500/[0.02] p-8 shadow-[0_0_60px_rgba(56,128,255,0.35)]">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-blue-500 text-white text-[11px] font-bold tracking-wider uppercase shadow-[0_0_20px_rgba(56,128,255,0.7)]">
                Most popular
              </div>
              <div className="w-11 h-11 rounded-xl grid place-items-center bg-blue-500/20 border border-blue-400/40 text-blue-200 mb-5">
                <Truck className="w-5 h-5" />
              </div>
              <div className="text-sm uppercase tracking-wider text-blue-200/80 mb-1">Shipping</div>
              <div className="text-2xl font-bold mb-1">$3 <span className="text-base font-medium text-white/60">/ order (≤ 1KG)</span></div>
              <div className="text-sm text-white/60 mb-6">+ $1 per additional KG</div>
              <ul className="space-y-3 text-sm">
                {["Pick & Pack", "Fulfillment", "Labeling", "Nationwide delivery"].map((x) => (
                  <li key={x} className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-blue-300 shrink-0" />
                    <span className="text-white/80">{x}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Storage */}
            <div className="relative rounded-3xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-white/[0.01] p-8 hover:border-blue-400/40 transition">
              <div className="w-11 h-11 rounded-xl grid place-items-center bg-blue-500/15 border border-blue-400/30 text-blue-300 mb-5">
                <Warehouse className="w-5 h-5" />
              </div>
              <div className="text-sm uppercase tracking-wider text-white/50 mb-1">Storage</div>
              <div className="text-2xl font-bold mb-6">FREE <span className="text-base font-medium text-white/60">forever</span></div>
              <ul className="space-y-3 text-sm">
                {[
                  "Unlimited SKUs",
                  "Free returns processing",
                  "Inventory dashboard",
                  "Zero monthly fees",
                ].map((x) => (
                  <li key={x} className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-blue-300 shrink-0" />
                    <span className="text-white/80">{x}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </Reveal>

      {/* ─── 10. VISION ─── */}
      <Reveal className="relative py-24 md:py-32">
        <div className="mx-auto max-w-6xl px-6 text-center">
          <div className="text-blue-300 text-xs uppercase tracking-[0.2em] font-semibold mb-4">The Vision</div>
          <h2 className="text-4xl md:text-6xl font-bold tracking-tight mb-6">
            Start in Pakistan.
            <br />
            <span className="bg-gradient-to-r from-blue-300 via-blue-400 to-blue-600 bg-clip-text text-transparent">Expand Everywhere.</span>
          </h2>
          <p className="text-white/70 text-lg max-w-2xl mx-auto mb-14">
            Pakistan is the launchpad. The infrastructure is the rocket. The world is the destination.
          </p>
          <div className="relative max-w-5xl mx-auto">
            <div className="absolute inset-0 -m-8 bg-[radial-gradient(closest-side,rgba(56,128,255,0.45),transparent_70%)] blur-3xl" />
            <div className="relative rounded-3xl overflow-hidden border border-blue-400/20 shadow-[0_0_80px_rgba(56,128,255,0.35)]">
              <img src={visionImg} alt="Global expansion map" loading="lazy" width={1536} height={896} className="w-full h-auto" />
            </div>
          </div>
        </div>
      </Reveal>

      {/* ─── 11. FINAL CTA ─── */}
      <Reveal id="cta" className="relative py-24 md:py-36">
        <div className="mx-auto max-w-6xl px-6">
          <div className="relative rounded-[2rem] overflow-hidden border border-blue-400/30 bg-gradient-to-br from-blue-900/40 via-[#0a1230] to-[#040814] p-10 md:p-16 text-center shadow-[0_0_100px_rgba(56,128,255,0.4)]">
            <div className="absolute inset-0 opacity-40">
              <img src={ctaImg} alt="" className="w-full h-full object-cover" loading="lazy" />
              <div className="absolute inset-0 bg-gradient-to-r from-[#040814] via-[#040814]/60 to-[#040814]" />
            </div>
            <div className="relative">
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-blue-400/30 bg-blue-500/10 text-xs font-medium text-blue-200 mb-6">
                <Zap className="w-3.5 h-3.5" /> Limited onboarding slots
              </div>
              <h2 className="text-4xl md:text-6xl font-bold tracking-tight mb-5">
                Ready to <span className="bg-gradient-to-r from-blue-300 to-blue-500 bg-clip-text text-transparent">Scale?</span>
              </h2>
              <p className="text-white/75 text-lg md:text-xl max-w-2xl mx-auto mb-10">
                Enter Pakistan in days, not months. Plug into our infrastructure and start shipping.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <a
                  href="mailto:contact@scalers.ma"
                  className="group inline-flex items-center gap-2 px-7 py-4 rounded-xl bg-gradient-to-r from-blue-500 to-blue-600 text-white font-semibold shadow-[0_0_50px_rgba(56,128,255,0.6)] hover:shadow-[0_0_70px_rgba(56,128,255,0.9)] transition"
                >
                  Let's Scale Together
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </a>
                <a
                  href="tel:+212628410863"
                  className="inline-flex items-center gap-2 px-7 py-4 rounded-xl border border-white/15 bg-white/[0.04] text-white hover:bg-white/[0.08] transition"
                >
                  <PhoneCall className="w-4 h-4" /> +212 6 28 41 08 63
                </a>
              </div>
            </div>
          </div>
        </div>
      </Reveal>

      {/* ─── 12. FOOTER ─── */}
      <footer className="relative border-t border-white/10 bg-[#02050d]/80 backdrop-blur">
        <div className="mx-auto max-w-7xl px-6 py-12 grid md:grid-cols-3 gap-10 items-start">
          <div>
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-400 to-blue-700 grid place-items-center shadow-[0_0_30px_rgba(56,128,255,0.6)]">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div className="leading-tight">
                <div className="font-bold text-lg">Scalers</div>
                <div className="text-[10px] uppercase tracking-[0.18em] text-blue-300/70">Scale Beyond Borders</div>
              </div>
            </div>
            <p className="text-sm text-white/55 max-w-xs">
              3PL & e-commerce infrastructure helping sellers enter Pakistan and scale COD businesses.
            </p>
          </div>

          <div>
            <div className="text-xs uppercase tracking-wider text-white/40 mb-4">Contact</div>
            <ul className="space-y-3 text-sm">
              <li className="flex items-center gap-2.5 text-white/75">
                <Globe2 className="w-4 h-4 text-blue-300" />
                <a href="https://scalers.ma" className="hover:text-white">scalers.ma</a>
              </li>
              <li className="flex items-center gap-2.5 text-white/75">
                <Mail className="w-4 h-4 text-blue-300" />
                <a href="mailto:contact@scalers.ma" className="hover:text-white">contact@scalers.ma</a>
              </li>
              <li className="flex items-center gap-2.5 text-white/75">
                <Phone className="w-4 h-4 text-blue-300" />
                <a href="tel:+212628410863" className="hover:text-white">+212 6 28 41 08 63</a>
              </li>
            </ul>
          </div>

          <div className="md:text-right">
            <div className="text-xs uppercase tracking-wider text-white/40 mb-4">Quick links</div>
            <ul className="space-y-2.5 text-sm">
              <li><a href="#opportunity" className="text-white/75 hover:text-white">Opportunity</a></li>
              <li><a href="#services" className="text-white/75 hover:text-white">Services</a></li>
              <li><a href="#pricing" className="text-white/75 hover:text-white">Pricing</a></li>
              <li>
                <button onClick={() => navigate("/login")} className="text-white/75 hover:text-white">
                  Sign in
                </button>
              </li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/5">
          <div className="mx-auto max-w-7xl px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-white/40">
            <div>© {new Date().getFullYear()} Scalers. All rights reserved.</div>
            <div>Built to scale beyond borders.</div>
          </div>
        </div>
      </footer>
    </div>
  );
}
