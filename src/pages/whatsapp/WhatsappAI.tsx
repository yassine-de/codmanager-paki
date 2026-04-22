import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sparkles, Brain, MessageSquare, Bot, Target, Smile, BarChart3, Package, AlertCircle, Globe, Image as ImageIcon, Mic, Volume2, Save, RefreshCw, Trash2, Search, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Settings = {
  id?: string;
  system_prompt: string;
  brand_tone: string;
  language_rules: string;
  product_context: string;
  model: string;
  temperature: number;
  confidence_threshold: number;
  max_tokens: number;
  response_lines: number;
  smart_follow_up_idle_hours: number;
  suggested_replies_enabled: boolean;
  full_auto_reply_enabled: boolean;
  intent_detection_enabled: boolean;
  sentiment_analysis_enabled: boolean;
  lead_qualification_enabled: boolean;
  order_tracking_enabled: boolean;
  ai_memory_enabled: boolean;
  smart_follow_up_enabled: boolean;
  language_detection_enabled: boolean;
  ai_image_analysis_enabled: boolean;
  voice_transcription_enabled: boolean;
  ai_voice_response_enabled: boolean;
};

type Memory = {
  id: string;
  customer_phone: string;
  summary: string | null;
  language: string | null;
  sentiment: string | null;
  intent: string | null;
  lead_score: number | null;
  facts: any;
  last_interaction_at: string;
};

const FEATURES = [
  { key: "suggested_replies_enabled", label: "Suggested Replies", desc: "Generate 2-3 reply suggestions in Inbox", icon: MessageSquare },
  { key: "full_auto_reply_enabled", label: "Full Auto Reply", desc: "AI auto-responds to incoming messages", icon: Bot },
  { key: "intent_detection_enabled", label: "Intent Detection", desc: "Classify customer message intents", icon: Target },
  { key: "sentiment_analysis_enabled", label: "Sentiment Analysis", desc: "Detect positive/neutral/negative tone", icon: Smile },
  { key: "lead_qualification_enabled", label: "Lead Qualification", desc: "Score contacts and update lead status", icon: BarChart3 },
  { key: "order_tracking_enabled", label: "Order Tracking", desc: "Detect order queries and provide status", icon: Package },
  { key: "ai_memory_enabled", label: "AI Memory", desc: "Remember context per contact across conversations", icon: Brain },
  { key: "smart_follow_up_enabled", label: "Smart Follow-up", desc: "Suggest follow-ups for idle conversations", icon: AlertCircle },
  { key: "language_detection_enabled", label: "Language Detection", desc: "Auto-detect and reply in customer language", icon: Globe },
  { key: "ai_image_analysis_enabled", label: "AI Image Analysis", desc: "Analyze images sent by customers and match products", icon: ImageIcon },
  { key: "voice_transcription_enabled", label: "Voice Auto-Transcription", desc: "Transcribe voice messages so AI can understand", icon: Mic },
  { key: "ai_voice_response_enabled", label: "AI Voice Response", desc: "Play AI replies as audio (text-to-speech)", icon: Volume2 },
] as const;

export default function WhatsappAI() {
  const [s, setS] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testInput, setTestInput] = useState("Salam, kayn dak l produit?");
  const [testResult, setTestResult] = useState<any>(null);
  const [memory, setMemory] = useState<Memory[]>([]);
  const [memSearch, setMemSearch] = useState("");

  useEffect(() => { load(); loadMemory(); }, []);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.from("whatsapp_ai_settings").select("*").eq("singleton", true).maybeSingle();
    if (error) toast.error(error.message);
    setS(data as any);
    setLoading(false);
  }

  async function loadMemory() {
    const { data } = await supabase.from("whatsapp_ai_memory").select("*").order("last_interaction_at", { ascending: false }).limit(50);
    setMemory((data as any) ?? []);
  }

  async function save() {
    if (!s) return;
    setSaving(true);
    const { id, ...rest } = s;
    const { error } = await supabase.from("whatsapp_ai_settings").update({ ...rest, updated_at: new Date().toISOString() }).eq("singleton", true);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("AI settings saved");
  }

  async function runTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-ai", {
        body: { mode: "suggest", text: testInput, customer_phone: "test_preview" },
      });
      if (error) throw error;
      setTestResult(data);
      if (!data?.ok) toast.error(data?.error || "AI test failed");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setTesting(false);
    }
  }

  async function deleteMemory(id: string) {
    const { error } = await supabase.from("whatsapp_ai_memory").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Memory cleared");
    loadMemory();
  }

  if (loading || !s) {
    return <div className="flex items-center justify-center h-64"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const filteredMem = memory.filter((m) =>
    !memSearch || m.customer_phone.includes(memSearch) || (m.summary || "").toLowerCase().includes(memSearch.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <Tabs defaultValue="features">
        <TabsList>
          <TabsTrigger value="features"><Sparkles className="h-4 w-4 mr-1.5" />AI Features</TabsTrigger>
          <TabsTrigger value="behavior"><Brain className="h-4 w-4 mr-1.5" />Behavior</TabsTrigger>
          <TabsTrigger value="test"><Bot className="h-4 w-4 mr-1.5" />Test Playground</TabsTrigger>
          <TabsTrigger value="memory"><MessageSquare className="h-4 w-4 mr-1.5" />Memory</TabsTrigger>
        </TabsList>

        {/* FEATURES TAB */}
        <TabsContent value="features" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" />AI Features</CardTitle>
              <Button onClick={save} disabled={saving} size="sm"><Save className="h-4 w-4 mr-1.5" />{saving ? "Saving..." : "Save"}</Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {FEATURES.map((f) => {
                const Icon = f.icon;
                const enabled = (s as any)[f.key] as boolean;
                return (
                  <div key={f.key} className="flex items-center justify-between rounded-lg border bg-card/40 p-3">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center">
                        <Icon className="h-4 w-4 text-foreground" />
                      </div>
                      <div>
                        <div className="text-sm font-medium">{f.label}</div>
                        <div className="text-xs text-muted-foreground">{f.desc}</div>
                      </div>
                    </div>
                    <Switch checked={enabled} onCheckedChange={(v) => setS({ ...s, [f.key]: v } as any)} />
                  </div>
                );
              })}
              {s.smart_follow_up_enabled && (
                <div className="rounded-lg border p-3 bg-muted/30">
                  <Label className="text-xs">Smart Follow-up — idle hours threshold</Label>
                  <Input
                    type="number"
                    className="mt-1 w-32"
                    value={s.smart_follow_up_idle_hours}
                    onChange={(e) => setS({ ...s, smart_follow_up_idle_hours: parseInt(e.target.value) || 0 })}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* BEHAVIOR TAB */}
        <TabsContent value="behavior" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2"><Brain className="h-5 w-5 text-primary" />System Prompt & Behavior</CardTitle>
              <Button onClick={save} disabled={saving} size="sm"><Save className="h-4 w-4 mr-1.5" />{saving ? "Saving..." : "Save"}</Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>SYSTEM PROMPT</Label>
                <Textarea rows={6} value={s.system_prompt} onChange={(e) => setS({ ...s, system_prompt: e.target.value })} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label>BRAND TONE</Label>
                  <Select value={s.brand_tone} onValueChange={(v) => setS({ ...s, brand_tone: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="friendly">😊 Friendly</SelectItem>
                      <SelectItem value="professional">🤝 Professional</SelectItem>
                      <SelectItem value="casual">😎 Casual</SelectItem>
                      <SelectItem value="formal">🎩 Formal</SelectItem>
                      <SelectItem value="enthusiastic">🚀 Enthusiastic</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>LANGUAGE RULES</Label>
                  <Input value={s.language_rules} onChange={(e) => setS({ ...s, language_rules: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>PRODUCT CONTEXT</Label>
                <Textarea rows={2} value={s.product_context} onChange={(e) => setS({ ...s, product_context: e.target.value })} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label>TEMPERATURE</Label>
                  <Slider value={[s.temperature]} min={0} max={1} step={0.05} onValueChange={(v) => setS({ ...s, temperature: v[0] })} />
                  <div className="text-xs text-muted-foreground text-center mt-1">{s.temperature.toFixed(2)}</div>
                </div>
                <div>
                  <Label>CONFIDENCE THRESHOLD</Label>
                  <Slider value={[s.confidence_threshold]} min={0} max={1} step={0.05} onValueChange={(v) => setS({ ...s, confidence_threshold: v[0] })} />
                  <div className="text-xs text-muted-foreground text-center mt-1">{s.confidence_threshold.toFixed(2)}</div>
                </div>
                <div>
                  <Label>MAX TOKENS</Label>
                  <Input type="number" value={s.max_tokens} onChange={(e) => setS({ ...s, max_tokens: parseInt(e.target.value) || 0 })} />
                </div>
              </div>
              <div>
                <Label>RESPONSE LINES — {s.response_lines}</Label>
                <Slider value={[s.response_lines]} min={1} max={15} step={1} onValueChange={(v) => setS({ ...s, response_lines: v[0] })} />
                <div className="flex justify-between text-xs text-muted-foreground mt-1">
                  <span>1 = very short</span><span>15 = long</span>
                </div>
              </div>
              <div>
                <Label>AI MODEL</Label>
                <Select value={s.model} onValueChange={(v) => setS({ ...s, model: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gpt-4o-mini">GPT-4o Mini — fastest, cheapest (recommended)</SelectItem>
                    <SelectItem value="gpt-4o">GPT-4o — best quality</SelectItem>
                    <SelectItem value="gpt-4-turbo">GPT-4 Turbo</SelectItem>
                    <SelectItem value="gpt-3.5-turbo">GPT-3.5 Turbo — legacy, very cheap</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TEST TAB */}
        <TabsContent value="test" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Bot className="h-5 w-5 text-primary" />AI Playground</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Customer message</Label>
                <Textarea rows={3} value={testInput} onChange={(e) => setTestInput(e.target.value)} />
              </div>
              <Button onClick={runTest} disabled={testing}>
                {testing ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1.5" />}
                Generate Suggestions
              </Button>
              {testResult && (
                <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
                  <div className="flex flex-wrap gap-2">
                    {testResult.intent && <Badge variant="secondary">Intent: {testResult.intent}</Badge>}
                    {testResult.sentiment && <Badge variant="secondary">Sentiment: {testResult.sentiment}</Badge>}
                    {testResult.language && <Badge variant="secondary">Lang: {testResult.language}</Badge>}
                    {testResult.confidence != null && <Badge variant="outline">Confidence: {Number(testResult.confidence).toFixed(2)}</Badge>}
                  </div>
                  <div className="space-y-2">
                    {(testResult.suggestions ?? []).map((sg: string, i: number) => (
                      <div key={i} className="rounded-md bg-background border p-2 text-sm whitespace-pre-wrap">{sg}</div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* MEMORY TAB */}
        <TabsContent value="memory" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2"><Brain className="h-5 w-5 text-primary" />AI Memory ({memory.length})</CardTitle>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input className="pl-8 w-64" placeholder="Search phone or summary..." value={memSearch} onChange={(e) => setMemSearch(e.target.value)} />
                </div>
                <Button variant="outline" size="sm" onClick={loadMemory}><RefreshCw className="h-4 w-4" /></Button>
              </div>
            </CardHeader>
            <CardContent>
              {filteredMem.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-8">No memory entries yet. Memory builds as the AI processes conversations.</div>
              ) : (
                <div className="space-y-2">
                  {filteredMem.map((m) => (
                    <div key={m.id} className="rounded-lg border p-3 bg-card/40">
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-sm font-medium">{m.customer_phone}</span>
                            {m.language && <Badge variant="outline" className="text-xs">{m.language}</Badge>}
                            {m.sentiment && <Badge variant={m.sentiment === "positive" ? "default" : m.sentiment === "negative" ? "destructive" : "secondary"} className="text-xs">{m.sentiment}</Badge>}
                            {m.intent && <Badge variant="secondary" className="text-xs">{m.intent}</Badge>}
                            {m.lead_score != null && <Badge variant="outline" className="text-xs">Lead: {m.lead_score}</Badge>}
                          </div>
                          {m.summary && <p className="text-xs text-muted-foreground line-clamp-3">{m.summary}</p>}
                          <p className="text-[10px] text-muted-foreground">{new Date(m.last_interaction_at).toLocaleString()}</p>
                        </div>
                        <Button size="icon" variant="ghost" onClick={() => deleteMemory(m.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
