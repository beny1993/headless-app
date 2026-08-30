import { useState, useEffect, useRef } from "react";
import {
  Search, ShoppingBag, Heart, User, Menu, X, Star, Plus, Minus,
  ChevronLeft, ChevronRight, Check, Package, MapPin,
  CreditCard, Clock, AlertCircle, TrendingUp, Users, BarChart2,
  Eye, Edit, Trash2, Filter, Grid, ChevronDown, Bell,
  LogOut, Settings, Home, ShoppingCart, FileText, Tag, Layers,
  MessageSquare, PieChart, Shield, Award, Camera,
  Phone, RefreshCw, Wallet, XCircle
} from "lucide-react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from "@/app/components/ui/sheet";
import { RadioGroup, RadioGroupItem } from "@/app/components/ui/radio-group";
import { Checkbox } from "@/app/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/app/components/ui/select";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/app/components/ui/input-otp";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer
} from "recharts";

// ─── Local assets (no CDN — see ATTRIBUTIONS.md) ─────────────────────────────
import imgCatDryFood from "@/assets/img/cat-dry-food.jpg";
import imgCatHygiene from "@/assets/img/cat-hygiene.jpg";
import imgCatSupplement from "@/assets/img/cat-supplement.jpg";
import imgCatToy from "@/assets/img/cat-toy.jpg";
import imgCatTreats from "@/assets/img/cat-treats.jpg";
import imgCatWetFood from "@/assets/img/cat-wet-food.jpg";
import imgCommunityBaron from "@/assets/img/community-baron.jpg";
import imgCommunityLuna from "@/assets/img/community-luna.jpg";
import imgCommunityMisha from "@/assets/img/community-misha.jpg";
import imgDogDryFood from "@/assets/img/dog-dry-food.jpg";
import imgDogTreats from "@/assets/img/dog-treats.jpg";
import imgHeroAbout from "@/assets/img/hero-about.jpg";
import imgHeroHome from "@/assets/img/hero-home.jpg";

// ─── Types ───────────────────────────────────────────────────────────────────
type Page =
  | "home" | "shop" | "product" | "about" | "checkout" | "account" | "admin-panel"
  | "login"    // phone OTP (two steps inside the page)
  | "result";  // payment result — one page, three states (see PaymentResultPage)

type PaymentMethod = "zarinpal" | "cod";
type ResultStatus = "success" | "failed" | "pending";

interface CartItem {
  id: number;
  name: string;
  brand: string;
  price: number;
  qty: number;
  image: string;
  stock: number; // qty is capped at this in the drawer and on the product page
}

interface Pet {
  id: number;
  name: string;
  type: "cat" | "dog";
  breed: string;
  age: string;
  weight: string;
  gender: "male" | "female";
  neutered: boolean;
  image?: string;
}

// ─── Data ────────────────────────────────────────────────────────────────────
const PRODUCTS = [
  { id: 1, sku: "RC-CAT-ADULT-1K", name: "غذای خشک پرمیوم گربه بالغ", brand: "Royal Canin", price: 285000, oldPrice: 320000, rating: 4.8, reviews: 124, image: imgCatDryFood, benefit: "مناسب گوارش حساس", category: "غذای خشک", pet: "cat", stock: 24 },
  { id: 2, sku: "HS-DOG-CHICKEN-2K", name: "غذای خشک سگ با مرغ و برنج", brand: "Hill's Science", price: 340000, oldPrice: null, rating: 4.9, reviews: 156, image: imgDogDryFood, benefit: "تقویت سیستم ایمنی", category: "غذای خشک", pet: "dog", stock: 12 },
  { id: 3, sku: "AP-CAT-TREAT-60", name: "تشویقی طبیعی مرغ و سبزیجات گربه", brand: "Applaws", price: 125000, oldPrice: null, rating: 4.9, reviews: 89, image: imgCatTreats, benefit: "بدون مواد مصنوعی", category: "تشویقی", pet: "cat", stock: 40 },
  { id: 4, sku: "ZW-DOG-TREAT-85", name: "تشویقی نرم سگ با طعم گوشت", brand: "Ziwi", price: 165000, oldPrice: 190000, rating: 4.7, reviews: 112, image: imgDogTreats, benefit: "بدون غلات، طبیعی ۱۰۰٪", category: "تشویقی", pet: "dog", stock: 18 },
  { id: 5, sku: "SH-CAT-WET-85", name: "غذای مرطوب سالمون و تن گربه", brand: "Sheba", price: 95000, oldPrice: null, rating: 4.7, reviews: 203, image: imgCatWetFood, benefit: "غنی از امگا ۳", category: "غذای تر", pet: "cat", stock: 0 },
  { id: 6, sku: "BP-CAT-SKIN-50", name: "مکمل پوست و مو گربه", brand: "Beaphar", price: 178000, oldPrice: 210000, rating: 4.6, reviews: 67, image: imgCatSupplement, benefit: "کاهش ریزش مو", category: "مکمل", pet: "cat", stock: 7 },
  { id: 7, sku: "NX-DOG-JOINT-60", name: "مکمل مفصل و استخوان سگ", brand: "Nutramax", price: 215000, oldPrice: null, rating: 4.8, reviews: 93, image: imgDogDryFood, benefit: "تقویت غضروف و مفاصل", category: "مکمل", pet: "dog", stock: 15 },
  { id: 8, sku: "SK-CAT-TOY-01", name: "اسباب‌بازی تعاملی پر و زنگوله", brand: "SmartyKat", price: 89000, oldPrice: null, rating: 4.5, reviews: 45, image: imgCatToy, benefit: "تحریک غریزه شکار", category: "اسباب‌بازی", pet: "cat", stock: 3 },
];

const REVENUE_DATA = [
  { month: "فروردین", revenue: 42000000, orders: 134 },
  { month: "اردیبهشت", revenue: 58000000, orders: 189 },
  { month: "خرداد", revenue: 51000000, orders: 162 },
  { month: "تیر", revenue: 74000000, orders: 241 },
  { month: "مرداد", revenue: 89000000, orders: 287 },
  { month: "شهریور", revenue: 95000000, orders: 312 },
];

/**
 * One order fixture for both detail views. `lines` is [productId, qty] — the app
 * snapshots title/sku/unit price onto order_items instead
 * ([[Design - Orders and Payments Schema]]). Ids are Latin so they can sit in a URL.
 */
const ORDERS = [
  { id: "10045", customer: "سارا محمدی", phone: "09120000000", date: "۱۴۰۵/۰۶/۰۵", status: "paid", method: "zarinpal", payment: "paid", province: "تهران", address: "خیابان ولیعصر، پلاک ۱۲، واحد ۳", postal: "1511153456", lines: [[1, 1], [3, 2]], fee: 25000, ref: "987654321" },
  { id: "10044", customer: "علی رضایی", phone: "09131111111", date: "۱۴۰۵/۰۶/۰۴", status: "processing", method: "zarinpal", payment: "paid", province: "اصفهان", address: "خیابان چهارباغ، کوچه ۵، پلاک ۸", postal: "8143354121", lines: [[2, 1]], fee: 42000, ref: "987654322" },
  { id: "10043", customer: "نیلوفر کریمی", phone: "09352222222", date: "۱۴۰۵/۰۶/۰۴", status: "shipped", method: "zarinpal", payment: "paid", province: "فارس", address: "شیراز، بلوار زند، پلاک ۳۱", postal: "7134851122", lines: [[6, 1]], fee: 55000, ref: "987654323" },
  { id: "10042", customer: "سارا محمدی", phone: "09120000000", date: "۱۴۰۵/۰۵/۲۸", status: "delivered", method: "cod", payment: "paid", province: "تهران", address: "خیابان ولیعصر، پلاک ۱۲، واحد ۳", postal: "1511153456", lines: [[1, 2], [8, 1]], fee: 25000, ref: null },
  { id: "10041", customer: "فاطمه نوری", phone: "09194444444", date: "۱۴۰۵/۰۵/۲۶", status: "failed", method: "zarinpal", payment: "failed", province: "خراسان رضوی", address: "مشهد، بلوار وکیل‌آباد، پلاک ۹", postal: "9177845632", lines: [[4, 1]], fee: 55000, ref: null },
  { id: "10040", customer: "سارا محمدی", phone: "09120000000", date: "۱۴۰۵/۰۵/۲۲", status: "pending_payment", method: "zarinpal", payment: "pending", province: "تهران", address: "خیابان ولیعصر، پلاک ۱۲، واحد ۳", postal: "1511153456", lines: [[7, 1]], fee: 25000, ref: null },
  { id: "10039", customer: "رضا اکبری", phone: "09155555555", date: "۱۴۰۵/۰۵/۱۸", status: "cancelled", method: "cod", payment: "failed", province: "البرز", address: "کرج، بلوار طالقانی، پلاک ۴۵", postal: "3197654321", lines: [[5, 1]], fee: 30000, ref: null },
] as const;

type Order = typeof ORDERS[number];

/** The seven statuses of [[Design - Orders and Payments Schema]], with their badges. */
const ORDER_STATUS: Record<string, { label: string; badge: string }> = {
  pending_payment: { label: "در انتظار پرداخت", badge: "bg-warning-soft text-warning" },
  paid:            { label: "پرداخت شده",        badge: "bg-info-soft text-info" },
  processing:      { label: "در حال پردازش",     badge: "bg-tan-soft text-tan-strong" },
  shipped:         { label: "ارسال شده",         badge: "bg-accent-soft text-accent-hover" },
  delivered:       { label: "تحویل شده",         badge: "bg-success-soft text-success-strong" },
  cancelled:       { label: "لغو شده",           badge: "bg-destructive-soft text-destructive" },
  failed:          { label: "ناموفق",            badge: "bg-muted text-muted-foreground" },
};

const PAYMENT_STATUS: Record<string, { label: string; badge: string }> = {
  pending: { label: "در انتظار پرداخت", badge: "bg-warning-soft text-warning" },
  paid:    { label: "پرداخت شده",        badge: "bg-success-soft text-success-strong" },
  failed:  { label: "ناموفق",            badge: "bg-destructive-soft text-destructive" },
};

/**
 * Transitions an ADMIN may trigger. Deliberately narrower than the full machine:
 * `paid` and `failed` arrive from Zarinpal verify / the reconcile job, never from
 * a button, so they are not offered here. Terminal states offer nothing.
 */
const ADMIN_TRANSITIONS: Record<string, string[]> = {
  pending_payment: ["cancelled"],
  paid: ["processing", "cancelled"],
  processing: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: [],
  cancelled: [],
  failed: [],
};

const CATEGORIES = ["غذای خشک", "غذای تر", "تشویقی", "مکمل", "اسباب‌بازی", "بهداشت"];

const LIFE_MOMENTS = [
  { id: 1, title: "وقت غذا", desc: "بهترین تغذیه برای سلامت روزانه", image: imgCatDryFood, color: "#F5ECD7", pet: "🐱" },
  { id: 2, title: "وقت بازی", desc: "سرگرمی هوشمند برای ذهن فعال", image: imgDogDryFood, color: "#EAE0D5", pet: "🐶" },
  { id: 3, title: "وقت استراحت", desc: "محیطی امن و راحت برای خواب", image: imgCatWetFood, color: "#E8EEE5", pet: "🐱" },
  { id: 4, title: "مراقبت روزانه", desc: "پوست، مو و بهداشت", image: imgDogTreats, color: "#EDE4DA", pet: "🐶" },
  { id: 5, title: "بیرون از خانه", desc: "سفر، پیاده‌روی و ماجراجویی", image: imgCatTreats, color: "#E5E8EE", pet: "🐶" },
];

const COMMUNITY_PETS = [
  { name: "لونا", owner: "سارا", quote: "لونا عاشق این تشویقیه.", image: imgCommunityLuna, span: "row-span-2" },
  { name: "آرکو", owner: "علی", quote: "هر روز صبح منتظر وعده‌اشه!", image: imgDogDryFood, span: "" },
  { name: "رکسی", owner: "امیر", quote: "سفر بدون رکسی معنی نداره.", image: imgDogTreats, span: "" },
  { name: "بارون", owner: "کاوه", quote: "بارون با این اسباب‌بازی ساعت‌ها بازی می‌کنه.", image: imgCommunityBaron, span: "row-span-2" },
  { name: "میشا", owner: "نیلوفر", quote: "بهترین خواب دنیا رو داره.", image: imgCommunityMisha, span: "" },
];

// All 31 provinces. The fee is a per-province rate — in the app it comes from
// GET /api/shipping/rates?province= ([[Story - Province Shipping Rates]]); these
// placeholder numbers exist so the checkout summary can show a real fee change.
const PROVINCES: { name: string; fee: number }[] = [
  { name: "تهران", fee: 25000 },
  { name: "البرز", fee: 30000 },
  { name: "قم", fee: 35000 },
  { name: "قزوین", fee: 35000 },
  { name: "مرکزی", fee: 38000 },
  { name: "سمنان", fee: 40000 },
  { name: "اصفهان", fee: 42000 },
  { name: "زنجان", fee: 42000 },
  { name: "گیلان", fee: 45000 },
  { name: "مازندران", fee: 45000 },
  { name: "گلستان", fee: 48000 },
  { name: "همدان", fee: 45000 },
  { name: "لرستان", fee: 48000 },
  { name: "کرمانشاه", fee: 50000 },
  { name: "کردستان", fee: 52000 },
  { name: "آذربایجان شرقی", fee: 52000 },
  { name: "آذربایجان غربی", fee: 55000 },
  { name: "اردبیل", fee: 55000 },
  { name: "ایلام", fee: 58000 },
  { name: "خوزستان", fee: 55000 },
  { name: "چهارمحال و بختیاری", fee: 52000 },
  { name: "کهگیلویه و بویراحمد", fee: 58000 },
  { name: "فارس", fee: 55000 },
  { name: "بوشهر", fee: 60000 },
  { name: "یزد", fee: 48000 },
  { name: "کرمان", fee: 58000 },
  { name: "هرمزگان", fee: 65000 },
  { name: "خراسان رضوی", fee: 55000 },
  { name: "خراسان شمالی", fee: 60000 },
  { name: "خراسان جنوبی", fee: 62000 },
  { name: "سیستان و بلوچستان", fee: 68000 },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatPrice(p: number) {
  return p.toLocaleString("fa-IR") + " تومان";
}

/** Every number on screen goes through a formatter — never a Persian literal. */
function fa(n: number) {
  return n.toLocaleString("fa-IR");
}

/** Order items, snapshotted from the catalog the way order_items are on the server. */
function orderLines(o: Order) {
  return o.lines.map(([id, qty]) => ({ ...PRODUCTS.find(p => p.id === id)!, qty }));
}

function orderTotals(o: Order) {
  const subtotal = orderLines(o).reduce((s, i) => s + i.price * i.qty, 0);
  return { subtotal, fee: o.fee, total: subtotal + o.fee };
}

/** Persian digits with no thousands grouping — order numbers, codes, timers. */
function faDigits(v: string | number) {
  return String(v).replace(/\d/g, d => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}

/** Jalali via Intl — no date dependency ([[Smokey Shop Info]]). */
function jalaliDate(d = new Date()) {
  return new Intl.DateTimeFormat("fa-IR", {
    calendar: "persian", year: "numeric", month: "long", day: "numeric",
  }).format(d);
}

function jalaliYear(d = new Date()) {
  return new Intl.DateTimeFormat("fa-IR", { calendar: "persian", year: "numeric" }).format(d);
}

function prefersReducedMotion() {
  return typeof window !== "undefined"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The one field-error pattern for the whole design: destructive border on the
 * control, small destructive text under it, wired with aria-invalid +
 * aria-describedby. Used by checkout, the OTP form and the pet form.
 */
function Field({ id, label, error, hint, children }: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: (props: {
    id: string;
    "aria-invalid": boolean;
    "aria-describedby": string | undefined;
    className: string;
  }) => React.ReactNode;
}) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium mb-1.5">{label}</label>
      {children({
        id,
        "aria-invalid": Boolean(error),
        "aria-describedby": describedBy,
        className: `w-full px-4 py-3 rounded-xl bg-secondary border text-start outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
          error ? "border-destructive bg-destructive-soft/40" : "border-border focus-visible:border-accent-strong"
        }`,
      })}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-xs text-destructive flex items-center gap-1">
          <AlertCircle size={12} className="shrink-0" /> {error}
        </p>
      )}
      {!error && hint && <p id={`${id}-hint`} className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <Star key={s} size={12} className={s <= Math.round(rating) ? "fill-accent text-accent" : "text-muted-foreground"} />
      ))}
    </div>
  );
}

// ─── Product Card ─────────────────────────────────────────────────────────────
function ProductCard({ product, onAddToCart, onNavigate }: {
  product: typeof PRODUCTS[0];
  onAddToCart: (item: CartItem) => void;
  onNavigate: (page: Page, id?: number) => void;
}) {
  const [wished, setWished] = useState(false);
  const [added, setAdded] = useState(false);

  function handleAdd(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onAddToCart({ id: product.id, name: product.name, brand: product.brand, price: product.price, qty: 1, image: product.image, stock: product.stock });
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  }

  const outOfStock = product.stock === 0;

  // The card is a real link (keyboard-reachable, cmd-clickable, crawlable);
  // the wishlist and add controls are buttons nested inside it.
  return (
    <a
      href={`#/product/${product.id}`}
      onClick={(e) => { e.preventDefault(); onNavigate("product", product.id); }}
      className="group relative block bg-card rounded-2xl overflow-hidden transition-[transform,box-shadow] duration-300 hover:shadow-lg hover:-translate-y-1"
    >
      <div className="relative aspect-square bg-secondary overflow-hidden">
        <img
          src={product.image}
          alt={product.name}
          className={`w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 ${outOfStock ? "grayscale opacity-60" : ""}`}
        />
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setWished(!wished); }}
          aria-label={wished ? `حذف ${product.name} از علاقه‌مندی‌ها` : `افزودن ${product.name} به علاقه‌مندی‌ها`}
          aria-pressed={wished}
          className="absolute top-3 start-3 w-10 h-10 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-sm transition-transform duration-200 hover:scale-110"
        >
          <Heart size={16} className={wished ? "fill-accent text-accent" : "text-muted-foreground"} />
        </button>
        {outOfStock ? (
          <span className="absolute top-3 end-3 bg-muted text-muted-foreground text-xs px-2 py-0.5 rounded-full font-medium">
            ناموجود
          </span>
        ) : product.oldPrice ? (
          <span className="absolute top-3 end-3 bg-accent-strong text-white text-xs px-2 py-0.5 rounded-full font-medium">
            تخفیف
          </span>
        ) : null}
      </div>
      <div className="p-4">
        <p className="text-xs text-muted-foreground mb-1">{product.brand}</p>
        <h3 className="text-sm font-semibold text-foreground leading-relaxed mb-2 line-clamp-2">{product.name}</h3>
        <p className="text-xs text-success-strong mb-3 flex items-center gap-1">
          <Check size={10} className="shrink-0" /> {product.benefit}
        </p>
        <div className="flex items-center gap-1.5 mb-3">
          <Stars rating={product.rating} />
          <span className="text-xs text-muted-foreground">({fa(product.reviews)})</span>
        </div>
        <div className="flex items-center justify-between">
          <div className="nums">
            <p className="font-bold text-foreground">{formatPrice(product.price)}</p>
            {product.oldPrice && <p className="text-xs text-muted-foreground line-through">{formatPrice(product.oldPrice)}</p>}
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={outOfStock}
            aria-label={outOfStock ? `${product.name} ناموجود است` : `افزودن ${product.name} به سبد خرید`}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-[transform,background-color] duration-200 ${
              outOfStock
                ? "bg-muted text-muted-foreground cursor-not-allowed"
                : added
                  ? "bg-success text-white scale-110"
                  : "bg-primary text-primary-foreground hover:bg-accent-strong"
            }`}
          >
            {outOfStock ? <X size={16} /> : added ? <Check size={16} /> : <Plus size={16} />}
          </button>
        </div>
      </div>
    </a>
  );
}

// ─── Nav ──────────────────────────────────────────────────────────────────────
function Navbar({ cartCount, onNavigate, onCartOpen, currentPage }: {
  cartCount: number;
  onNavigate: (page: Page) => void;
  onCartOpen: () => void;
  currentPage: Page;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 60);
    window.addEventListener("scroll", handler);
    return () => window.removeEventListener("scroll", handler);
  }, []);

  // Hero pages have dark backgrounds — keep icons/text white until scrolled
  const isOverDark = !scrolled && (currentPage === "home" || currentPage === "about");

  // «مجله اسموکی» removed — no magazine story exists, so it was dead navigation.
  const links = [
    { label: "خانه", page: "home" as Page },
    { label: "فروشگاه", page: "shop" as Page },
    { label: "درباره ما", page: "about" as Page },
  ];

  if (currentPage === "admin-panel") return null;

  const iconCls = isOverDark
    ? "w-10 h-10 rounded-full hover:bg-white/20 flex items-center justify-center transition-colors text-white"
    : "w-10 h-10 rounded-full hover:bg-secondary flex items-center justify-center transition-colors text-foreground";

  return (
    <>
      <nav className={`fixed top-0 inset-x-0 z-50 transition-[background-color,box-shadow] duration-300 ${scrolled ? "bg-background/95 backdrop-blur-md shadow-sm" : "bg-transparent"}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Left: Icons */}
            <div className="flex items-center gap-1">
              <button onClick={() => onNavigate("shop")} className={iconCls} aria-label="جستجو در محصولات">
                <Search size={18} />
              </button>
              <button onClick={() => onNavigate("account")} className={iconCls} aria-label="حساب کاربری">
                <User size={18} />
              </button>
              <button className={iconCls} aria-label="علاقه‌مندی‌ها">
                <Heart size={18} />
              </button>
              <button onClick={onCartOpen} className={`relative ${iconCls}`} aria-label={`سبد خرید (${fa(cartCount)} کالا)`}>
                <ShoppingBag size={18} />
                {cartCount > 0 && (
                  <span className="absolute top-0.5 end-0.5 min-w-4 h-4 px-1 bg-accent-strong text-white text-[10px] rounded-full flex items-center justify-center font-bold">
                    {fa(cartCount)}
                  </span>
                )}
              </button>
              <button
                onClick={() => setMobileOpen(!mobileOpen)}
                className={`md:hidden ${iconCls}`}
                aria-label={mobileOpen ? "بستن منو" : "باز کردن منو"}
                aria-expanded={mobileOpen}
              >
                {mobileOpen ? <X size={18} /> : <Menu size={18} />}
              </button>
            </div>

            {/* Center: Links */}
            <div className="hidden md:flex items-center gap-6">
              {links.map((l) => (
                <button
                  key={l.label}
                  onClick={() => onNavigate(l.page)}
                  className={`text-sm font-medium transition-colors hover:text-accent-on-dark ${
                    isOverDark
                      ? currentPage === l.page ? "text-accent-on-dark" : "text-white/90"
                      : currentPage === l.page ? "text-accent-strong" : "text-foreground"
                  }`}
                >
                  {l.label}
                </button>
              ))}
            </div>

            {/* Right: Logo */}
            <button onClick={() => onNavigate("home")} className="flex items-center gap-2">
              <span className={`text-2xl font-black tracking-tight transition-colors ${isOverDark ? "text-white" : "text-foreground"}`}>Smokey</span>
              <span className={`hidden sm:inline text-xs border-s ps-2 ms-1 transition-colors ${isOverDark ? "text-white/60 border-white/30" : "text-muted-foreground border-border"}`}>فروشگاه حیوانات</span>
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile menu — Sheet gives focus trap, Escape and scroll lock for free.
          side="right" is the start side in RTL. */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="right" className="w-72">
          <SheetHeader>
            <SheetTitle>منو</SheetTitle>
            <SheetDescription className="sr-only">پیمایش بخش‌های فروشگاه</SheetDescription>
          </SheetHeader>
          <nav className="px-4 flex flex-col gap-1">
            {links.map((l) => (
              <button
                key={l.label}
                onClick={() => { onNavigate(l.page); setMobileOpen(false); }}
                className={`text-start text-lg font-semibold py-3.5 px-2 rounded-xl transition-colors hover:bg-secondary ${currentPage === l.page ? "text-accent-strong" : ""}`}
              >
                {l.label}
              </button>
            ))}
            <button
              onClick={() => { onNavigate("account"); setMobileOpen(false); }}
              className="text-start text-lg font-semibold py-3.5 px-2 rounded-xl transition-colors hover:bg-secondary border-t border-border mt-2 pt-4"
            >
              حساب کاربری
            </button>
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}

// ─── Cart Drawer ──────────────────────────────────────────────────────────────
function CartDrawer({ open, onClose, items, onUpdate, onNavigate }: {
  open: boolean;
  onClose: () => void;
  items: CartItem[];
  onUpdate: (id: number, qty: number) => void;
  onNavigate: (page: Page) => void;
}) {
  const total = items.reduce((s, i) => s + i.price * i.qty, 0);
  // Same count as the navbar badge: total quantity, not line count.
  const count = items.reduce((s, i) => s + i.qty, 0);

  // Sheet (Radix dialog): focus trap, Escape, scroll lock, and nothing focusable
  // while closed. side="right" is the start side in RTL — the design's side.
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-sm p-0 gap-0">
        <SheetHeader className="p-5 border-b border-border">
          <SheetTitle className="text-lg text-start">سبد خرید ({fa(count)})</SheetTitle>
          <SheetDescription className="sr-only">اقلام سبد خرید شما</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-center py-16">
              <ShoppingBag size={48} className="text-muted-foreground" />
              <p className="font-semibold">سبد خرید شما خالی است</p>
              <p className="text-sm text-muted-foreground">هنوز چیزی اضافه نکرده‌ای — از فروشگاه شروع کن.</p>
              <button
                onClick={() => { onNavigate("shop"); onClose(); }}
                className="px-6 py-3 bg-accent-strong hover:bg-accent-hover text-white font-bold rounded-xl transition-colors"
              >
                مشاهده محصولات
              </button>
            </div>
          ) : (
            items.map((item) => (
              <div key={item.id} className="flex gap-3 bg-secondary/50 rounded-xl p-3">
                <img src={item.image} alt={item.name} className="w-16 h-16 rounded-lg object-cover bg-muted" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground">{item.brand}</p>
                  <p className="text-sm font-semibold leading-tight line-clamp-2">{item.name}</p>
                  <p className="text-sm font-bold mt-1 nums">{formatPrice(item.price)}</p>
                  <button
                    onClick={() => onUpdate(item.id, 0)}
                    className="mt-1.5 -mx-1 px-1 py-1.5 text-xs text-destructive hover:underline flex items-center gap-1"
                  >
                    <Trash2 size={12} /> حذف
                  </button>
                </div>
                <div className="flex flex-col items-center gap-1">
                  <button
                    onClick={() => onUpdate(item.id, Math.min(item.stock, item.qty + 1))}
                    disabled={item.qty >= item.stock}
                    aria-label={`افزایش تعداد ${item.name}`}
                    className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Plus size={14} />
                  </button>
                  <span className="text-sm font-medium nums" aria-live="polite">{fa(item.qty)}</span>
                  <button
                    onClick={() => onUpdate(item.id, item.qty - 1)}
                    aria-label={`کاهش تعداد ${item.name}`}
                    className="w-10 h-10 rounded-full border border-border flex items-center justify-center transition-colors hover:bg-secondary"
                  >
                    <Minus size={14} />
                  </button>
                  {item.qty >= item.stock && (
                    <span className="text-[10px] text-muted-foreground text-center leading-tight">حداکثر موجودی</span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {items.length > 0 && (
          <div className="p-5 border-t border-border space-y-4">
            <div className="flex items-center justify-between">
              <span className="font-bold text-lg nums">{formatPrice(total)}</span>
              <span className="text-muted-foreground">جمع اقلام</span>
            </div>
            <p className="text-xs text-muted-foreground">هزینه ارسال در مرحله آدرس بر اساس استان محاسبه می‌شود.</p>
            <button onClick={() => { onNavigate("checkout"); onClose(); }} className="w-full py-3.5 bg-accent-strong hover:bg-accent-hover text-white font-bold rounded-xl transition-colors">
              ادامه فرایند خرید
            </button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Hero Section ─────────────────────────────────────────────────────────────
function HeroSection({ onNavigate }: { onNavigate: (page: Page) => void }) {
  return (
    <section className="relative min-h-screen flex items-center overflow-hidden bg-ink">
      {/* background image */}
      <div className="absolute inset-0">
        <img
          src={imgHeroHome}
          alt="سگ در محیط خانه"
          className="w-full h-full object-cover opacity-50"
        />
        <div className="absolute inset-0 bg-gradient-to-l from-ink/90 via-ink/50 to-transparent" />
      </div>

      {/* blob decoration */}
      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full bg-accent/10 blur-3xl" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 pt-24 pb-16 w-full">
        <div className="max-w-2xl">
          <div className="flex items-center gap-3 mb-6">
            <span className="inline-block text-accent-on-dark text-sm font-medium tracking-widest uppercase">زندگی با اسموکی</span>
            <span className="flex items-center gap-1.5 bg-white/10 backdrop-blur-sm rounded-full px-3 py-1 text-white/80 text-xs border border-white/20">
              <span>🐱</span> گربه <span className="text-white/30 mx-1">·</span> <span>🐶</span> سگ
            </span>
          </div>
          <h1 className="text-white font-black leading-tight mb-6" style={{ fontSize: "clamp(2.5rem, 6vw, 4.5rem)", lineHeight: 1.2 }}>
            زندگی بهتر،<br />کنار بهترین<br /><span className="text-accent-on-dark">دوستت</span>
          </h1>
          <p className="text-white/70 text-lg leading-relaxed mb-10 max-w-lg">
            محصولاتی که با دقت برای سلامت، شادی و زندگی روزمره‌ی گربه‌ها و سگ‌ها انتخاب شده‌اند.
          </p>
          <div className="flex flex-wrap gap-4">
            <button
              onClick={() => onNavigate("shop")}
              className="px-8 py-4 bg-accent-strong hover:bg-accent-hover text-white font-bold rounded-xl transition-[transform,background-color] duration-200 hover:scale-105"
            >
              کشف محصولات
            </button>
            <button
              onClick={() => onNavigate("about")}
              className="px-8 py-4 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl backdrop-blur-sm border border-white/20 transition-colors duration-200"
            >
              داستان اسموکی
            </button>
          </div>
        </div>
      </div>

      {/* scroll hint */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-white/60 animate-bounce">
        <ChevronDown size={20} />
      </div>
    </section>
  );
}

// ─── Life Moments ─────────────────────────────────────────────────────────────
function LifeMomentsSection({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // dir 1 = reading-forward. In an RTL scroll container the inline axis runs
  // negative, so forward is a negative scrollLeft delta — hence the flip.
  function scrollByCards(dir: -1 | 1) {
    const el = scrollRef.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === "rtl";
    el.scrollBy({
      left: (rtl ? -dir : dir) * (el.clientWidth * 0.8),
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }

  return (
    <section className="py-24 overflow-hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-8">
        <div className="flex items-end justify-between mb-12 gap-4">
          <div className="flex items-center gap-2">
            <button
              onClick={() => scrollByCards(1)}
              aria-label="اسلاید بعدی"
              className="w-10 h-10 rounded-full border border-border hover:bg-secondary flex items-center justify-center transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => scrollByCards(-1)}
              aria-label="اسلاید قبلی"
              className="w-10 h-10 rounded-full border border-border hover:bg-secondary flex items-center justify-center transition-colors"
            >
              <ChevronRight size={16} />
            </button>
            <button onClick={() => onNavigate("shop")} className="text-sm text-accent-strong font-medium hover:underline flex items-center gap-1 ms-2">
              <ChevronLeft size={14} /> مشاهده همه
            </button>
          </div>
          <div className="text-end">
            <p className="text-muted-foreground text-sm mb-1">خرید بر اساس لحظه</p>
            <h2 className="text-4xl font-black">زندگی با حیوانات خانگی</h2>
          </div>
        </div>
        <div ref={scrollRef} className="flex gap-5 overflow-x-auto pb-4 snap-x snap-mandatory" style={{ scrollbarWidth: "none" }}>
          {LIFE_MOMENTS.map((m) => (
            <a
              key={m.id}
              href="#/shop"
              onClick={(e) => { e.preventDefault(); onNavigate("shop"); }}
              className="snap-start shrink-0 w-64 md:w-72 group"
            >
              <div className="relative h-80 rounded-2xl overflow-hidden mb-4">
                <img src={m.image} alt={m.title} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                <span className="absolute top-3 end-3 bg-black/30 backdrop-blur-sm text-white text-sm px-2.5 py-1 rounded-full border border-white/20">
                  {m.pet}
                </span>
                <div className="absolute bottom-4 end-4 start-4">
                  <h3 className="text-white font-bold text-xl">{m.title}</h3>
                  <p className="text-white/80 text-sm mt-1">{m.desc}</p>
                </div>
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Smokey Recommends ────────────────────────────────────────────────────────
function SmokeyRecommendsSection({ onAddToCart, onNavigate }: {
  onAddToCart: (item: CartItem) => void;
  onNavigate: (page: Page, id?: number) => void;
}) {
  return (
    <section className="py-24 bg-secondary/40">
      <div className="max-w-7xl mx-auto px-4 sm:px-8">
        <div className="text-center mb-14">
          <span className="inline-block text-accent-strong text-sm font-medium mb-3">کیوریت شده با دقت</span>
          <h2 className="text-4xl font-black mb-3">انتخاب‌های اسموکی</h2>
          <p className="text-muted-foreground max-w-lg mx-auto">محصولاتی که اسموکی شخصاً تجربه کرده و توصیه می‌کند</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {[PRODUCTS[0], PRODUCTS[1], PRODUCTS[2], PRODUCTS[3]].map((p) => (
            <ProductCard key={p.id} product={p} onAddToCart={onAddToCart} onNavigate={onNavigate} />
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Personalized Journey ─────────────────────────────────────────────────────
function PersonalizedJourney({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const [step, setStep] = useState(0);
  const [pet, setPet] = useState<"cat" | "dog" | null>(null);
  const [age, setAge] = useState<string | null>(null);
  const [need, setNeed] = useState<string | null>(null);

  const ages = ["بچه (۰–۱ سال)", "جوان (۱–۷ سال)", "سالمند (۷+ سال)"];
  const needs = ["پوست و مو", "گوارش", "مفاصل", "کنترل وزن", "سرگرمی", "آرامش"];

  function reset() { setStep(0); setPet(null); setAge(null); setNeed(null); }

  return (
    <section className="py-24">
      <div className="max-w-3xl mx-auto px-4 sm:px-8 text-center">
        <span className="inline-block text-accent-strong text-sm font-medium mb-3">خرید شخصی‌سازی شده</span>
        <h2 className="text-4xl font-black mb-3">برای کی خرید می‌کنی؟</h2>
        <p className="text-muted-foreground mb-12">چند سوال کوتاه تا بهترین محصولات رو بهت پیشنهاد بدیم</p>

        <div className="bg-card rounded-3xl p-8 shadow-sm border border-border">
          {step === 0 && (
            <div>
              <p className="font-semibold text-lg mb-6">حیوان خانگی شما؟</p>
              <div className="flex gap-4 justify-center">
                {[{ label: "گربه", val: "cat" as const, icon: "🐱" }, { label: "سگ", val: "dog" as const, icon: "🐶" }].map((o) => (
                  <button key={o.val} onClick={() => { setPet(o.val); setStep(1); }}
                    className="flex flex-col items-center gap-3 px-12 py-8 rounded-2xl border-2 border-border hover:border-accent-strong hover:bg-accent/5 transition-colors duration-200 group">
                    <span className="text-5xl">{o.icon}</span>
                    <span className="font-semibold group-hover:text-accent-strong">{o.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div>
              <p className="font-semibold text-lg mb-6">سن {pet === "cat" ? "گربه" : "سگ"}ت چقدره؟</p>
              <div className="flex flex-col gap-3">
                {ages.map((a) => (
                  <button key={a} onClick={() => { setAge(a); setStep(2); }}
                    className="py-4 px-6 rounded-xl border-2 border-border hover:border-accent-strong hover:bg-accent/5 font-medium transition-colors duration-200 text-start">
                    {a}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <p className="font-semibold text-lg mb-6">بیشترین نیاز؟</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {needs.map((n) => (
                  <button key={n} onClick={() => { setNeed(n); setStep(3); }}
                    className="py-4 px-4 rounded-xl border-2 border-border hover:border-accent-strong hover:bg-accent/5 font-medium transition-colors duration-200">
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center mx-auto mb-4">
                <Check size={32} className="text-success-strong" />
              </div>
              <p className="text-lg font-bold mb-2">محصولات مناسب پیدا شد!</p>
              <p className="text-muted-foreground mb-6">
                برای {pet === "cat" ? "گربه" : "سگ"} {age} با نیاز {need}
              </p>
              <div className="flex gap-3 justify-center">
                <button onClick={() => onNavigate("shop")} className="px-6 py-3 bg-accent-strong hover:bg-accent-hover text-white font-bold rounded-xl transition-colors">
                  مشاهده محصولات
                </button>
                <button onClick={reset} className="px-6 py-3 border-2 border-border rounded-xl font-medium hover:bg-secondary transition-colors">
                  شروع مجدد
                </button>
              </div>
            </div>
          )}

          {step > 0 && step < 3 && (
            <button onClick={() => setStep(s => s - 1)} className="mt-6 text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mx-auto">
              <ChevronRight size={14} /> بازگشت
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

// ─── Featured Story ───────────────────────────────────────────────────────────
function FeaturedStory({ onNavigate }: { onNavigate: (page: Page) => void }) {
  return (
    <section className="py-24 bg-ink">
      <div className="max-w-7xl mx-auto px-4 sm:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 rounded-3xl overflow-hidden">
          <div className="relative h-80 lg:h-auto">
            <img
              src={imgCatHygiene}
              alt="گربه و آب"
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-r from-transparent to-ink/30 lg:hidden" />
          </div>
          <div className="bg-ink-soft p-10 lg:p-14 flex flex-col justify-center">
            <span className="text-accent-on-dark text-sm font-medium mb-4 uppercase tracking-wide">راهنمای اسموکی</span>
            <h2 className="text-white text-3xl lg:text-4xl font-black mb-5 leading-tight">
              چرا بعضی گربه‌ها<br />آب کافی نمی‌خورند؟
            </h2>
            <p className="text-white/70 leading-relaxed mb-8">
              کم‌آبی در گربه‌ها یکی از مشکلات شایعی است که بسیاری از صاحبان نادیده می‌گیرند. دلایل آن متعدد است و راه‌حل‌های ساده‌ای وجود دارد.
            </p>
            {/* The magazine is parked on the backlog — the CTA points at the
                products this section is about instead of a dead article route. */}
            <button onClick={() => onNavigate("shop")} className="self-start px-6 py-3 bg-accent-strong hover:bg-accent-hover text-white font-bold rounded-xl transition-colors">
              مشاهده آبخوری‌ها و غذای تر
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Shop the Routine ─────────────────────────────────────────────────────────
function ShopRoutine({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const [active, setActive] = useState(0);
  const times = [
    { label: "صبح", sub: "غذا", emoji: "🌅", products: ["غذای خشک پرمیوم", "آبخوری هوشمند"] },
    { label: "ظهر", sub: "بازی", emoji: "☀️", products: ["اسباب‌بازی تعاملی", "تونل بازی"] },
    { label: "عصر", sub: "مراقبت", emoji: "🌤️", products: ["برس مخصوص", "مکمل پوست"] },
    { label: "شب", sub: "آرامش", emoji: "🌙", products: ["تخت راحت", "اسپری آرامش‌بخش"] },
  ];

  return (
    <section className="py-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-8">
        <div className="text-center mb-14">
          <span className="inline-block text-accent-strong text-sm font-medium mb-3">روتین روزانه</span>
          <h2 className="text-4xl font-black">روتین روزانه یک گربه خوشحال</h2>
        </div>

        <div className="flex flex-col lg:flex-row gap-8 items-start">
          {/* Timeline */}
          <div className="flex lg:flex-col gap-2 w-full lg:w-48 shrink-0 overflow-x-auto lg:overflow-x-visible pb-2 lg:pb-0">
            {times.map((t, i) => (
              <button
                key={i}
                onClick={() => setActive(i)}
                className={`flex-shrink-0 flex items-center gap-3 p-4 rounded-xl text-start transition-colors duration-200 ${active === i ? "bg-accent-strong text-white" : "hover:bg-secondary"}`}
              >
                <span className="text-2xl">{t.emoji}</span>
                <div>
                  <p className="font-bold">{t.label}</p>
                  <p className={`text-sm ${active === i ? "text-white/80" : "text-muted-foreground"}`}>{t.sub}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Products for active time */}
          <div className="flex-1 bg-secondary/40 rounded-3xl p-8">
            <h3 className="text-xl font-bold mb-2">{times[active].label} — {times[active].sub}</h3>
            <p className="text-muted-foreground mb-6">محصولات پیشنهادی برای این مرحله</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {times[active].products.map((p, i) => (
                <a
                  key={i}
                  href="#/product/1"
                  onClick={(e) => { e.preventDefault(); onNavigate("product", 1); }}
                  className="bg-card rounded-xl p-5 flex items-center gap-4 hover:shadow-md transition-shadow"
                >
                  <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center text-2xl shrink-0">
                    {times[active].emoji}
                  </div>
                  <div>
                    <p className="font-semibold text-sm">{p}</p>
                    <p className="text-xs text-accent-strong mt-1">مشاهده محصول ←</p>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Community ────────────────────────────────────────────────────────────────
function CommunitySection() {
  return (
    <section className="py-24 bg-secondary/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-8">
        <div className="text-center mb-14">
          <span className="inline-block text-accent-strong text-sm font-medium mb-3">داستان‌های واقعی</span>
          <h2 className="text-4xl font-black">خانواده اسموکی</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 auto-rows-[180px]">
          {COMMUNITY_PETS.map((p, i) => (
            <figure key={i} className={`relative rounded-2xl overflow-hidden group ${p.span}`}>
              <img src={p.image} alt={`${p.name}، حیوان خانگی ${p.owner}`} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
              <figcaption className="absolute bottom-3 inset-x-3">
                <p className="text-white font-bold">{p.name}</p>
                <p className="text-white/90 text-xs mt-0.5">«{p.quote}»</p>
              </figcaption>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Categories ───────────────────────────────────────────────────────────────
function CategoriesSection({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const cats = [
    { name: "غذای خشک", img: imgCatDryFood },
    { name: "غذای تر", img: imgCatWetFood },
    { name: "تشویقی", img: imgCatTreats },
    { name: "مکمل", img: imgCatSupplement },
    { name: "اسباب‌بازی", img: imgCatToy },
    { name: "بهداشت", img: imgCatHygiene },
  ];

  return (
    <section className="py-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-8">
        <div className="flex items-end justify-between mb-12">
          <button onClick={() => onNavigate("shop")} className="text-sm text-accent-strong font-medium hover:underline flex items-center gap-1">
            <ChevronLeft size={14} /> همه دسته‌بندی‌ها
          </button>
          <h2 className="text-4xl font-black">فروشگاه</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {cats.map((c, i) => (
            <a
              key={i}
              href="#/shop"
              onClick={(e) => { e.preventDefault(); onNavigate("shop"); }}
              className={`relative block rounded-2xl overflow-hidden group ${i === 0 || i === 3 ? "row-span-2" : ""}`}
              style={{ height: i === 0 || i === 3 ? undefined : "160px", minHeight: "160px" }}
            >
              <img src={c.img} alt="" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" style={{ height: "100%" }} />
              <div className="absolute inset-0 bg-black/40 group-hover:bg-black/30 transition-colors" />
              <div className="absolute bottom-4 end-4">
                <h3 className="text-white font-black text-xl">{c.name}</h3>
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── Brand Philosophy ─────────────────────────────────────────────────────────
function PhilosophySection({ onNavigate }: { onNavigate: (page: Page) => void }) {
  return (
    <section className="py-24 bg-ink">
      <div className="max-w-4xl mx-auto px-4 sm:px-8 text-center">
        <p className="text-white/60 text-sm font-medium tracking-widest uppercase mb-6">فلسفه اسموکی</p>
        <h2 className="text-white font-black mb-6" style={{ fontSize: "clamp(2rem, 5vw, 3.5rem)" }}>
          ما هر چیزی را<br /><span className="text-accent-on-dark">نمی‌فروشیم.</span>
        </h2>
        <p className="text-white/60 text-lg leading-relaxed mb-8 max-w-2xl mx-auto">
          محصولات اسموکی با تمرکز بر کیفیت، ترکیبات، کاربرد واقعی و تجربه‌ی حیوانات خانگی انتخاب می‌شوند.
        </p>
        <button onClick={() => onNavigate("about")} className="text-accent-on-dark font-medium hover:text-accent-on-dark/80 transition-colors border-b border-accent-on-dark pb-0.5">
          بیشتر درباره انتخاب محصولات
        </button>
      </div>
    </section>
  );
}

// ─── Footer ───────────────────────────────────────────────────────────────────
function Footer({ onNavigate }: { onNavigate: (page: Page) => void }) {
  return (
    <footer className="bg-ink text-white/70">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-16">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-12">
          <div className="col-span-2 md:col-span-1">
            <p className="text-2xl font-black text-white mb-3">Smokey</p>
            <p className="text-sm leading-relaxed">فروشگاه تخصصی محصولات حیوانات خانگی. کیفیت اول، همیشه.</p>
          </div>
          {[
            { title: "فروشگاه", links: ["گربه", "سگ", "غذا", "اسباب‌بازی", "مکمل"] },
            { title: "اسموکی", links: ["درباره ما", "ارسال رایگان", "ضمانت کیفیت"] },
            { title: "پشتیبانی", links: ["تماس با ما", "راهنمای خرید", "سوالات متداول", "بازگشت کالا"] },
          ].map((col) => (
            <div key={col.title}>
              <p className="text-white font-bold mb-4">{col.title}</p>
              <ul className="space-y-2">
                {col.links.map((l) => (
                  <li key={l}><button onClick={() => onNavigate("home")} className="text-sm py-1 inline-block hover:text-accent-on-dark transition-colors">{l}</button></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="border-t border-white/10 pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm">© {jalaliYear()} اسموکی. تمام حقوق محفوظ است.</p>
          <p className="text-xs">ساخته شده با ❤️ برای حیوانات خانگی ایران</p>
        </div>
      </div>
    </footer>
  );
}

// ─── HOME PAGE ────────────────────────────────────────────────────────────────
function HomePage({ onAddToCart, onNavigate }: {
  onAddToCart: (item: CartItem) => void;
  onNavigate: (page: Page, id?: number) => void;
}) {
  return (
    <main>
      <HeroSection onNavigate={onNavigate} />
      <LifeMomentsSection onNavigate={onNavigate} />
      <SmokeyRecommendsSection onAddToCart={onAddToCart} onNavigate={onNavigate} />
      <PersonalizedJourney onNavigate={onNavigate} />
      <FeaturedStory onNavigate={onNavigate} />
      <ShopRoutine onNavigate={onNavigate} />
      <CommunitySection />
      <CategoriesSection onNavigate={onNavigate} />
      <PhilosophySection onNavigate={onNavigate} />
    </main>
  );
}

// ─── SHOP PAGE ────────────────────────────────────────────────────────────────
function ShopPage({ onAddToCart, onNavigate }: {
  onAddToCart: (item: CartItem) => void;
  onNavigate: (page: Page, id?: number) => void;
}) {
  const [filters, setFilters] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("محبوب‌ترین");
  const [viewMode, setViewMode] = useState<"grid" | "needs">("grid");
  const [filterOpen, setFilterOpen] = useState(false);

  const filterOptions = {
    "نوع حیوان": ["گربه", "سگ"],
    "دسته‌بندی": ["غذای خشک", "غذای تر", "تشویقی", "مکمل", "اسباب‌بازی"],
    "برند": ["Royal Canin", "Applaws", "Sheba", "Beaphar", "Hill's Science"],
    "نیاز": ["پوست و مو", "گوارش", "مفاصل", "سرگرمی"],
  };

  function toggleFilter(f: string) {
    setFilters(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]);
  }

  // Client-side and deliberately shallow — it exists so the design can show the
  // no-results state. The real page filters server-side from the URL query
  // params ([[Story - Shop Listing Page]]). OR inside a group, AND across groups.
  const PET = { "گربه": "cat", "سگ": "dog" } as Record<string, string>;
  const results = PRODUCTS
    .filter(p => {
      const q = query.trim();
      if (q && !`${p.name} ${p.brand}`.includes(q)) return false;
      return Object.values(filterOptions).every(opts => {
        const picked = opts.filter(o => filters.includes(o));
        return picked.length === 0 || picked.some(o =>
          PET[o] === p.pet || o === p.category || o === p.brand || p.benefit.includes(o));
      });
    })
    .sort((a, b) =>
      sort === "ارزان‌ترین" ? a.price - b.price
        : sort === "گران‌ترین" ? b.price - a.price
          : sort === "بیشترین امتیاز" ? b.rating - a.rating
            : 0);

  const needs = [
    { label: "برای گوارش حساس", icon: "🍃", count: 14 },
    { label: "کنترل وزن", icon: "⚖️", count: 8 },
    { label: "پوست و مو درخشان", icon: "✨", count: 11 },
    { label: "سرگرمی داخل خانه", icon: "🎮", count: 19 },
    { label: "مفاصل و استخوان", icon: "💪", count: 7 },
    { label: "آرامش و کاهش استرس", icon: "🌸", count: 5 },
  ];

  return (
    <main className="pt-20 min-h-screen">
      <div className="bg-secondary/30 py-10 px-4 sm:px-8">
        <div className="max-w-7xl mx-auto">
          <p className="text-muted-foreground text-sm mb-2">خانه / فروشگاه</p>
          <h1 className="text-4xl font-black mb-2">فروشگاه</h1>
          <p className="text-muted-foreground">بهترین محصولات برای حیوان خانگی شما</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-8">
        {/* Search — rendered here, wired to the search API on port */}
        <div className="relative mb-5 max-w-xl">
          <label htmlFor="shop-search" className="sr-only">جستجو در محصولات</label>
          <Search size={16} className="absolute top-1/2 -translate-y-1/2 start-4 text-muted-foreground pointer-events-none" />
          <input
            id="shop-search"
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="جستجو بین محصولات…"
            className="w-full ps-11 pe-4 py-3 rounded-xl bg-secondary border border-border outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-accent-strong"
          />
        </div>

        {/* Toolbar */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <button onClick={() => setFilterOpen(true)} className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-border hover:bg-secondary transition-colors text-sm font-medium lg:hidden">
              <Filter size={14} /> فیلتر {filters.length > 0 && `(${fa(filters.length)})`}
            </button>
            <div className="flex gap-2" role="group" aria-label="نحوه نمایش">
              <button onClick={() => setViewMode("grid")} aria-label="نمایش شبکه‌ای" aria-pressed={viewMode === "grid"} className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${viewMode === "grid" ? "bg-primary text-primary-foreground" : "border border-border hover:bg-secondary"}`}>
                <Grid size={14} />
              </button>
              <button onClick={() => setViewMode("needs")} aria-label="نمایش بر اساس نیاز" aria-pressed={viewMode === "needs"} className={`px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${viewMode === "needs" ? "bg-primary text-primary-foreground" : "border border-border hover:bg-secondary"}`}>
                <Layers size={14} />
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground text-sm" aria-live="polite">{fa(results.length)} محصول</span>
            <label htmlFor="shop-sort" className="sr-only">ترتیب نمایش</label>
            <select id="shop-sort" value={sort} onChange={e => setSort(e.target.value)} className="px-4 py-2.5 rounded-xl border border-border bg-background text-sm font-medium transition-colors focus-visible:border-accent-strong">
              {["محبوب‌ترین", "جدیدترین", "ارزان‌ترین", "گران‌ترین", "بیشترین امتیاز"].map(o => <option key={o}>{o}</option>)}
            </select>
          </div>
        </div>

        {viewMode === "needs" ? (
          <div>
            <p className="text-muted-foreground mb-6">به جای دسته‌بندی، بر اساس نیاز حیوان خانگی‌ات پیدا کن</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {needs.map((n) => (
                <button key={n.label} onClick={() => setViewMode("grid")} className="p-6 bg-card rounded-2xl border border-border hover:border-accent-strong hover:shadow-md text-start transition-[border-color,box-shadow] duration-200">
                  <span className="text-4xl block mb-3">{n.icon}</span>
                  <p className="font-semibold mb-1">{n.label}</p>
                  <p className="text-sm text-muted-foreground">{n.count.toLocaleString("fa-IR")} محصول</p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex gap-8">
            {/* Sidebar filters - desktop */}
            <aside className="hidden lg:block w-56 shrink-0">
              <p className="font-bold mb-4">فیلترها</p>
              {Object.entries(filterOptions).map(([group, opts]) => (
                <fieldset key={group} className="mb-6">
                  <legend className="text-sm font-semibold mb-2 text-muted-foreground">{group}</legend>
                  <div className="space-y-1">
                    {opts.map(o => (
                      <div key={o} className="flex items-center gap-2.5 py-1.5">
                        <Checkbox
                          id={`f-${o}`}
                          checked={filters.includes(o)}
                          onCheckedChange={() => toggleFilter(o)}
                          className="data-[state=checked]:bg-accent-strong data-[state=checked]:border-accent-strong"
                        />
                        <label htmlFor={`f-${o}`} className="text-sm font-normal cursor-pointer select-none">{o}</label>
                      </div>
                    ))}
                  </div>
                </fieldset>
              ))}
              {filters.length > 0 && (
                <button onClick={() => setFilters([])} className="text-sm text-accent-strong hover:underline">
                  پاک کردن فیلترها
                </button>
              )}
            </aside>

            {/* Product grid */}
            {results.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center gap-3 py-24 bg-secondary/30 rounded-3xl">
                <span className="text-5xl">🔍</span>
                <p className="font-bold text-lg">محصولی با این فیلترها پیدا نشد</p>
                <p className="text-muted-foreground text-sm max-w-sm">
                  می‌توانی فیلترها را کم کنی یا عبارت دیگری جستجو کنی.
                </p>
                <button
                  onClick={() => { setFilters([]); setQuery(""); }}
                  className="mt-2 px-6 py-3 bg-accent-strong hover:bg-accent-hover text-white font-bold rounded-xl transition-colors"
                >
                  پاک کردن همه فیلترها
                </button>
              </div>
            ) : (
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {results.map(p => <ProductCard key={p.id} product={p} onAddToCart={onAddToCart} onNavigate={onNavigate} />)}
              </div>
            )}
          </div>
        )}

        {/* Mobile filters — Sheet from the bottom (focus trap, Escape, scroll lock) */}
        <Sheet open={filterOpen} onOpenChange={setFilterOpen}>
          <SheetContent side="bottom" className="max-h-[80vh] overflow-y-auto rounded-t-3xl lg:hidden">
            <SheetHeader className="px-0">
              <SheetTitle className="text-start text-lg">فیلترها</SheetTitle>
              <SheetDescription className="sr-only">فیلتر کردن محصولات فروشگاه</SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-6">
              {Object.entries(filterOptions).map(([group, opts]) => (
                <fieldset key={group} className="mb-6">
                  <legend className="font-semibold mb-3">{group}</legend>
                  <div className="flex flex-wrap gap-2">
                    {opts.map(o => (
                      <button
                        key={o}
                        onClick={() => toggleFilter(o)}
                        aria-pressed={filters.includes(o)}
                        className={`px-4 py-2.5 rounded-xl text-sm border-2 transition-colors ${filters.includes(o) ? "bg-accent-strong border-accent-strong text-white" : "border-border"}`}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                </fieldset>
              ))}
              <button
                onClick={() => setFilterOpen(false)}
                className="w-full py-3.5 bg-accent-strong hover:bg-accent-hover text-white font-bold rounded-xl transition-colors"
              >
                نمایش {fa(results.length)} محصول
              </button>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </main>
  );
}

// ─── PRODUCT PAGE ─────────────────────────────────────────────────────────────
function ProductPage({ productId, onAddToCart, onNavigate }: {
  productId: number;
  onAddToCart: (item: CartItem) => void;
  onNavigate: (page: Page, id?: number) => void;
}) {
  const product = PRODUCTS.find(p => p.id === productId) || PRODUCTS[0];
  const [qty, setQty] = useState(1);
  const [activeTab, setActiveTab] = useState("benefits");
  const [activeImg, setActiveImg] = useState(0);
  const [wished, setWished] = useState(false);

  const tabs = [
    { id: "benefits", label: "چرا این محصول؟" },
    { id: "ingredients", label: "ترکیبات" },
    { id: "specs", label: "مشخصات" },
    { id: "reviews", label: "نظرات" },
  ];

  const benefits = ["مناسب گوارش حساس", "بدون غلات", "منبع پروتئین باکیفیت", "مناسب گربه بالغ", "غنی از آنتی‌اکسیدان‌ها"];

  const reviews = [
    { name: "سارا م.", pet: "گربه، ۳ ساله", rating: 5, text: "خیلی راضی‌ام، گربه‌ام با ولع می‌خوره و موهاش هم خیلی بهتر شده." },
    { name: "علی ر.", pet: "گربه، ۵ ساله", rating: 4, text: "کیفیت خوبه ولی قیمتش کمی بالاست. در کل توصیه می‌کنم." },
    { name: "مریم ک.", pet: "گربه، ۲ ساله", rating: 5, text: "بهترین غذایی که تا حالا امتحان کردیم. دیگه تغییر نمی‌دیم!" },
  ];

  const thumbs = [product.image, ...PRODUCTS.slice(0, 3).map(p => p.image)];
  const outOfStock = product.stock === 0;
  const lowStock = product.stock > 0 && product.stock <= 5;

  return (
    <main className="pt-20 min-h-screen">
      <div className="max-w-7xl mx-auto px-4 sm:px-8 py-8">
        {/* Breadcrumb */}
        <nav aria-label="مسیر صفحه" className="flex items-center gap-2 text-sm text-muted-foreground mb-8">
          <a href="#/home" onClick={(e) => { e.preventDefault(); onNavigate("home"); }} className="hover:text-foreground">خانه</a>
          <ChevronLeft size={12} />
          <a href="#/shop" onClick={(e) => { e.preventDefault(); onNavigate("shop"); }} className="hover:text-foreground">فروشگاه</a>
          <ChevronLeft size={12} />
          <span className="text-foreground line-clamp-1" aria-current="page">{product.name}</span>
        </nav>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 mb-16">
          {/* Gallery */}
          <div className="space-y-4">
            <div className="aspect-square rounded-3xl overflow-hidden bg-secondary">
              <img src={thumbs[activeImg]} alt={product.name} className="w-full h-full object-cover" />
            </div>
            <div className="flex gap-3">
              {thumbs.map((img, i) => (
                <button key={i} onClick={() => setActiveImg(i)} aria-label={`نمایش تصویر ${fa(i + 1)}`} aria-pressed={activeImg === i} className={`w-16 h-16 rounded-xl overflow-hidden border-2 transition-colors ${activeImg === i ? "border-accent-strong" : "border-transparent"}`}>
                  <img src={img} alt="" className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </div>

          {/* Info */}
          <div className="flex flex-col">
            <p className="text-muted-foreground text-sm mb-1">{product.brand}</p>
            <h1 className="text-3xl font-black mb-3 leading-tight">{product.name}</h1>
            <div className="flex items-center gap-3 mb-4">
              <Stars rating={product.rating} />
              <span className="text-sm text-muted-foreground">{fa(product.rating)} ({fa(product.reviews)} نظر)</span>
            </div>
            <div className="flex items-center gap-3 mb-2">
              <span className="text-3xl font-black">{formatPrice(product.price)}</span>
              {product.oldPrice && <span className="text-lg text-muted-foreground line-through">{formatPrice(product.oldPrice)}</span>}
            </div>
            {outOfStock ? (
              <div className="flex items-start gap-2 mb-6 p-3 rounded-xl bg-muted border border-border">
                <AlertCircle size={16} className="text-muted-foreground shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold">فعلاً ناموجود است</p>
                  <p className="text-xs text-muted-foreground mt-0.5">به‌محض شارژ موجودی دوباره اینجا قرار می‌گیرد.</p>
                </div>
              </div>
            ) : lowStock ? (
              <p className="text-sm text-warning flex items-center gap-1 mb-6">
                <AlertCircle size={14} /> تنها {fa(product.stock)} عدد باقی مانده
              </p>
            ) : (
              <p className="text-sm text-success-strong flex items-center gap-1 mb-6">
                <Check size={14} /> موجود در انبار — ارسال امروز
              </p>
            )}

            {/* Variant */}
            <div className="mb-6">
              <p className="text-sm font-semibold mb-2">اندازه / وزن</p>
              <div className="flex gap-2 flex-wrap">
                {["۵۰۰ گرم", "۱ کیلو", "۲ کیلو", "۴ کیلو"].map((v, i) => (
                  <button key={v} className={`px-4 py-2 rounded-xl border-2 text-sm font-medium transition-colors ${i === 1 ? "border-accent-strong bg-accent/10 text-accent-strong" : "border-border hover:border-accent-strong"}`}>{v}</button>
                ))}
              </div>
            </div>

            {/* Qty + Add */}
            <div className="flex gap-3 mb-6">
              <div className="flex items-center border-2 border-border rounded-xl overflow-hidden">
                <button onClick={() => setQty(q => Math.max(1, q - 1))} disabled={outOfStock} aria-label="کاهش تعداد" className="w-11 h-12 flex items-center justify-center hover:bg-secondary transition-colors disabled:opacity-40"><Minus size={14} /></button>
                <span className="w-12 text-center font-medium nums" aria-live="polite">{fa(qty)}</span>
                <button onClick={() => setQty(q => Math.min(product.stock, q + 1))} disabled={outOfStock || qty >= product.stock} aria-label="افزایش تعداد" className="w-11 h-12 flex items-center justify-center hover:bg-secondary transition-colors disabled:opacity-40"><Plus size={14} /></button>
              </div>
              <button
                onClick={() => { onAddToCart({ ...product, qty }); }}
                disabled={outOfStock}
                className="flex-1 py-3 bg-accent-strong hover:bg-accent-hover text-white font-bold rounded-xl transition-colors disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
              >
                {outOfStock ? "ناموجود" : "افزودن به سبد خرید"}
              </button>
              <button onClick={() => setWished(!wished)} aria-label={wished ? "حذف از علاقه‌مندی‌ها" : "افزودن به علاقه‌مندی‌ها"} aria-pressed={wished} className={`w-12 h-12 rounded-xl border-2 flex items-center justify-center transition-colors ${wished ? "border-accent-strong bg-accent/10" : "border-border hover:border-accent-strong"}`}>
                <Heart size={18} className={wished ? "fill-accent text-accent" : ""} />
              </button>
            </div>

            {/* Trust badges */}
            <div className="grid grid-cols-3 gap-3 p-4 bg-secondary/50 rounded-2xl">
              {[
                { icon: <Package size={16} />, text: "ارسال رایگان بالای ۲۰۰ هزار" },
                { icon: <Shield size={16} />, text: "ضمانت اصالت کالا" },
                { icon: <Award size={16} />, text: "رضایت ۹۸٪ مشتریان" },
              ].map((b, i) => (
                <div key={i} className="flex flex-col items-center gap-1.5 text-center">
                  <div className="text-accent-strong">{b.icon}</div>
                  <p className="text-xs text-muted-foreground leading-tight">{b.text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="mb-16">
          <div className="flex gap-1 border-b border-border mb-8 overflow-x-auto">
            {tabs.map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                className={`px-5 py-3 text-sm font-semibold whitespace-nowrap transition-colors border-b-2 -mb-px ${activeTab === t.id ? "border-accent-strong text-accent-strong" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
                {t.label}
              </button>
            ))}
          </div>

          {activeTab === "benefits" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {benefits.map((b, i) => (
                <div key={i} className="flex items-center gap-3 p-4 bg-secondary/50 rounded-xl">
                  <div className="w-8 h-8 rounded-full bg-success/20 flex items-center justify-center shrink-0">
                    <Check size={14} className="text-success-strong" />
                  </div>
                  <p className="font-medium">{b}</p>
                </div>
              ))}
            </div>
          )}

          {activeTab === "ingredients" && (
            <div className="prose max-w-none">
              <p className="text-muted-foreground leading-relaxed">مرغ (۳۰٪)، برنج (۲۵٪)، ذرت (۱۵٪)، پودر ماهی (۱۰٪)، چربی مرغ (۸٪)، الیاف گیاهی، ویتامین‌ها و مواد معدنی، عصاره گیاهی.</p>
            </div>
          )}

          {activeTab === "specs" && (
            <div className="space-y-3">
              {[["پروتئین خام", "۳۲٪"], ["چربی خام", "۱۵٪"], ["رطوبت", "حداکثر ۸٪"], ["فیبر خام", "۴٪"], ["انرژی", "۳۶۵۰ kcal/kg"]].map(([k, v]) => (
                <div key={k} className="flex items-center justify-between py-3 border-b border-border">
                  <span className="font-medium text-muted-foreground">{v}</span>
                  <span className="font-semibold">{k}</span>
                </div>
              ))}
            </div>
          )}

          {activeTab === "reviews" && (
            <div className="space-y-4">
              {reviews.map((r, i) => (
                <div key={i} className="p-5 bg-card rounded-2xl border border-border">
                  <div className="flex items-start justify-between mb-2">
                    <div className="text-sm text-muted-foreground">{r.pet}</div>
                    <div>
                      <p className="font-semibold text-sm">{r.name}</p>
                      <Stars rating={r.rating} />
                    </div>
                  </div>
                  <p className="text-sm leading-relaxed">{r.text}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Smokey says */}
        <div className="bg-ink rounded-3xl p-8 mb-16 flex gap-6 items-start">
          <div className="w-14 h-14 rounded-full bg-accent-strong flex items-center justify-center text-2xl shrink-0">🐱</div>
          <div>
            <p className="text-accent-on-dark text-sm font-medium mb-2">نظر اسموکی</p>
            <p className="text-white leading-relaxed">این محصول یکی از بهترین‌هایی‌ه که تست کردیم. فرمولاسیون متعادلی داره و برای گربه‌هایی که معده حساس دارن واقعاً مناسبه.</p>
          </div>
        </div>

        {/* Related products */}
        <div>
          <h2 className="text-2xl font-black mb-6">کنارش این‌ها هم به کارت میاد</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {PRODUCTS.filter(p => p.id !== product.id).slice(0, 4).map(p => (
              <ProductCard key={p.id} product={p} onAddToCart={onAddToCart} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

// ─── ABOUT PAGE ───────────────────────────────────────────────────────────────
function AboutPage({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const values = [
    { icon: <Award size={20} />, title: "کیفیت قبل از تعداد", desc: "ترجیح می‌دهیم کمتر بفروشیم اما بهترین را بفروشیم." },
    { icon: <Shield size={20} />, title: "صداقت در پیشنهاد", desc: "فقط چیزی پیشنهاد می‌دهیم که خودمان به آن ایمان داریم." },
    { icon: <Heart size={20} />, title: "احترام به حیوانات", desc: "رفاه حیوانات در تمام تصمیمات ما اولویت دارد." },
    { icon: <Check size={20} />, title: "تجربه واقعی", desc: "محصولاتمان را واقعاً تست می‌کنیم، نه فقط مطالعه." },
  ];

  const process = [
    { step: "بررسی", desc: "تحقیق عمیق روی ترکیبات و برند" },
    { step: "انتخاب", desc: "انتخاب بهترین‌ها از بین صدها محصول" },
    { step: "تجربه", desc: "تست واقعی توسط تیم و مشتریان" },
    { step: "پیشنهاد", desc: "ارائه با اطمینان کامل" },
  ];

  return (
    <main className="pt-20 min-h-screen">
      {/* Hero */}
      <section className="relative h-[70vh] flex items-center bg-ink overflow-hidden">
        <img src={imgHeroAbout} alt="اسموکی" className="absolute inset-0 w-full h-full object-cover opacity-40" />
        <div className="absolute inset-0 bg-gradient-to-l from-ink to-transparent" />
        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-8">
          <p className="text-accent-on-dark font-medium mb-4 text-sm uppercase tracking-wide">داستان ما</p>
          <h1 className="text-white font-black" style={{ fontSize: "clamp(2rem, 5vw, 4rem)", lineHeight: 1.2 }}>
            همه‌چیز از عشق<br />به یک گربه<br /><span className="text-accent-on-dark">شروع شد.</span>
          </h1>
        </div>
      </section>

      {/* Story */}
      <section className="py-24">
        <div className="max-w-4xl mx-auto px-4 sm:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <img src={imgCommunityLuna} alt="اسموکی گربه" className="rounded-3xl h-96 w-full object-cover" />
            <div>
              <h2 className="text-3xl font-black mb-6">این اسموکی‌ه</h2>
              <p className="text-muted-foreground leading-relaxed mb-4">
                وقتی اسموکی وارد زندگی‌مان شد، متوجه شدیم که پیدا کردن محصولات واقعاً مناسب چقدر سخت است. بازار پر از گزینه‌هاست اما اطلاعات درست کمیاب.
              </p>
              <p className="text-muted-foreground leading-relaxed mb-4">
                اسموکی فروشگاه از همین سوال ساده متولد شد: «چه محصولی واقعاً برای حیوان خانگی من خوب است؟»
              </p>
              <p className="text-muted-foreground leading-relaxed">
                امروز هر محصولی که پیشنهاد می‌دهیم، از فیلتر دقیق کیفیت، ترکیبات، و تجربه واقعی گذشته.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Process */}
      <section className="py-24 bg-secondary/30">
        <div className="max-w-5xl mx-auto px-4 sm:px-8">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-black">فرآیند انتخاب محصولات</h2>
          </div>
          <div className="flex flex-col md:flex-row gap-6 relative">
            {process.map((p, i) => (
              <div key={i} className="flex-1 text-center relative">
                <div className="w-12 h-12 rounded-full bg-accent-strong text-white flex items-center justify-center font-black text-lg mx-auto mb-4">
                  {(i + 1).toLocaleString("fa-IR")}
                </div>
                <h3 className="font-bold text-lg mb-2">{p.step}</h3>
                <p className="text-muted-foreground text-sm">{p.desc}</p>
                {i < process.length - 1 && <div className="hidden md:block absolute top-6 left-0 w-full h-0.5 bg-border -z-10" />}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="py-24">
        <div className="max-w-5xl mx-auto px-4 sm:px-8">
          <div className="text-center mb-14">
            <h2 className="text-3xl font-black">ارزش‌های ما</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {values.map((v, i) => (
              <div key={i} className="p-7 bg-card rounded-2xl border border-border">
                <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center text-accent-strong mb-4">{v.icon}</div>
                <h3 className="font-bold text-lg mb-2">{v.title}</h3>
                <p className="text-muted-foreground">{v.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 bg-accent-strong text-center">
        <h2 className="text-white font-black text-4xl mb-4">به خانواده اسموکی خوش اومدی.</h2>
        <button onClick={() => onNavigate("shop")} className="mt-4 px-8 py-4 bg-white text-accent-strong font-bold rounded-xl hover:bg-white/90 transition-colors">
          کشف محصولات
        </button>
      </section>
    </main>
  );
}

// ─── OTP LOGIN ────────────────────────────────────────────────────────────────
/**
 * Two steps in one page: phone entry -> 6-digit code ([[Story - Phone OTP Authentication]]).
 * There are no passwords anywhere — this is the only customer login.
 * The code inputs are dir="ltr": Persian copy, but a phone number and an OTP
 * are read left-to-right.
 */
function LoginPage({ onNavigate, onLogin, nextLabel }: {
  onNavigate: (page: Page) => void;
  onLogin: () => void;
  nextLabel?: string;
}) {
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (seconds <= 0) return;
    const t = setTimeout(() => setSeconds(x => x - 1), 1000);
    return () => clearTimeout(t);
  }, [seconds]);

  function sendCode() {
    // Iranian mobile shape; the real normalization (Persian digits, +98/0098/0)
    // lives in the auth story's util.
    if (!/^0?9\d{9}$/.test(phone.replace(/[^\d]/g, ""))) {
      setError("شماره موبایل معتبر نیست. مثال: ۰۹۱۲۱۲۳۴۵۶۷");
      return;
    }
    setError(undefined);
    setStep("code");
    setSeconds(120);
  }

  function verify(value: string) {
    // 111111 is the design's "wrong code" trigger so the error state is demoable.
    if (value === "111111") {
      setError("کد وارد شده صحیح نیست یا منقضی شده است.");
      setCode("");
      return;
    }
    setError(undefined);
    onLogin();
  }

  return (
    <main className="pt-20 min-h-screen bg-secondary/20 flex items-start justify-center">
      <div className="w-full max-w-md px-4 sm:px-8 py-12">
        <button onClick={() => onNavigate("home")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground mb-8 text-sm">
          <ChevronRight size={14} /> بازگشت به فروشگاه
        </button>

        <div className="bg-card rounded-3xl p-7 border border-border shadow-sm">
          <div className="w-14 h-14 rounded-2xl bg-accent/10 text-accent-strong flex items-center justify-center mb-5">
            {step === "phone" ? <Phone size={22} /> : <MessageSquare size={22} />}
          </div>

          {step === "phone" ? (
            <>
              <h1 className="text-2xl font-black mb-2">ورود به اسموکی</h1>
              <p className="text-muted-foreground text-sm mb-7">
                شماره موبایلت را وارد کن؛ یک کد شش‌رقمی برایت پیامک می‌کنیم.
                {nextLabel && <> برای {nextLabel} باید وارد شوی.</>}
              </p>

              <form onSubmit={(e) => { e.preventDefault(); sendCode(); }}>
                <Field id="login-phone" label="شماره موبایل" error={error} hint="بدون کد کشور، مثل ۰۹۱۲۱۲۳۴۵۶۷">
                  {(props) => (
                    <input
                      {...props}
                      type="tel"
                      inputMode="numeric"
                      autoComplete="tel"
                      dir="ltr"
                      placeholder="0912 123 4567"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className={`${props.className} text-start tracking-widest nums`}
                    />
                  )}
                </Field>
                <button type="submit" className="w-full mt-6 py-3.5 bg-accent-strong hover:bg-accent-hover text-white font-bold rounded-xl transition-colors">
                  دریافت کد تایید
                </button>
              </form>
              <p className="text-xs text-muted-foreground mt-5 leading-relaxed">
                با ورود، <button className="text-accent-strong hover:underline">قوانین و حریم خصوصی</button> اسموکی را می‌پذیری.
              </p>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-black mb-2">کد تایید را وارد کن</h1>
              <p className="text-muted-foreground text-sm mb-7">
                کد شش‌رقمی به شماره <span dir="ltr" className="font-medium nums">{phone}</span> پیامک شد.{" "}
                <button onClick={() => { setStep("phone"); setError(undefined); setCode(""); }} className="text-accent-strong hover:underline">
                  ویرایش شماره
                </button>
              </p>

              <div dir="ltr" className="flex justify-center mb-2">
                <InputOTP
                  maxLength={6}
                  value={code}
                  onChange={(v: string) => { setCode(v); if (error) setError(undefined); }}
                  onComplete={verify}
                >
                  <InputOTPGroup className="gap-2">
                    {[0, 1, 2, 3, 4, 5].map(i => (
                      <InputOTPSlot
                        key={i}
                        index={i}
                        aria-invalid={Boolean(error)}
                        className={`w-11 h-13 text-lg rounded-xl border ${error ? "border-destructive" : "border-border"}`}
                      />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>

              {error && (
                <p className="mt-3 text-xs text-destructive flex items-center justify-center gap-1">
                  <AlertCircle size={12} /> {error}
                </p>
              )}

              <button
                onClick={() => verify(code)}
                disabled={code.length < 6}
                className="w-full mt-6 py-3.5 bg-accent-strong hover:bg-accent-hover text-white font-bold rounded-xl transition-colors disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
              >
                تایید و ورود
              </button>

              <div className="mt-5 text-center text-sm">
                {seconds > 0 ? (
                  <p className="text-muted-foreground flex items-center justify-center gap-1.5">
                    <Clock size={14} />
                    ارسال دوباره کد تا <span className="nums font-medium">{faDigits(Math.floor(seconds / 60))}:{faDigits(String(seconds % 60).padStart(2, "0"))}</span>
                  </p>
                ) : (
                  <button onClick={() => { setSeconds(120); setError(undefined); }} className="text-accent-strong font-medium hover:underline flex items-center gap-1.5 mx-auto">
                    <RefreshCw size={14} /> ارسال دوباره کد
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground mt-6">
          مشکلی پیش آمد؟ با پشتیبانی تماس بگیر: <span dir="ltr" className="nums">۰۲۱-۱۲۳۴۵۶۷۸</span>
        </p>
      </div>
    </main>
  );
}

// ─── CHECKOUT PAGE ────────────────────────────────────────────────────────────
/**
 * اطلاعات (prefilled from the session) -> آدرس (province drives the fee)
 * -> پرداخت (Zarinpal / COD) -> submit -> the result page.
 * The speed-based shipping chooser is gone: the fee is a per-province rate
 * ([[Story - Province Shipping Rates]]), not something the customer picks.
 */
function CheckoutPage({ cartItems, onNavigate, onPlaceOrder }: {
  cartItems: CartItem[];
  onNavigate: (page: Page, arg?: number | string) => void;
  onPlaceOrder: (o: { method: PaymentMethod; province: string; fee: number }) => void;
}) {
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    name: "سارا محمدی",     // from the OTP session — not re-collected
    phone: "۰۹۱۲۰۰۰۰۰۰۰",  // ditto
    province: "",
    address: "",
    postal: "",
    method: "zarinpal" as PaymentMethod,
  });

  const total = cartItems.reduce((s, i) => s + i.price * i.qty, 0);
  const fee = PROVINCES.find(p => p.name === form.province)?.fee ?? null;
  const steps = ["اطلاعات", "آدرس", "پرداخت"];

  function update(k: string, v: string) {
    setForm(f => ({ ...f, [k]: v }));
    setErrors(e => ({ ...e, [k]: "" }));
  }

  function validateAddress() {
    const e: Record<string, string> = {};
    if (!form.province) e.province = "استان را انتخاب کن.";
    if (form.address.trim().length < 10) e.address = "آدرس کامل را وارد کن (حداقل ۱۰ حرف).";
    if (!/^\d{10}$/.test(form.postal.replace(/[^\d]/g, ""))) e.postal = "کد پستی باید ۱۰ رقم باشد.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function next() {
    if (step === 2 && !validateAddress()) return;
    setStep(s => s + 1);
  }

  function submit() {
    // Locked while submitting: a double submit would create two orders.
    // ponytail: client-side lock only, matching the checkout design note.
    setSubmitting(true);
    onPlaceOrder({ method: form.method, province: form.province, fee: fee ?? 0 });
  }

  // Empty cart guard — /checkout is not a page you can sit on with nothing in it.
  if (cartItems.length === 0) {
    return (
      <main className="pt-20 min-h-screen bg-secondary/20">
        <div className="max-w-md mx-auto px-4 py-24 text-center">
          <ShoppingBag size={48} className="mx-auto mb-5 text-muted-foreground" />
          <h1 className="text-2xl font-black mb-2">سبد خرید خالی است</h1>
          <p className="text-muted-foreground mb-7">برای تسویه حساب اول چند محصول به سبد اضافه کن.</p>
          <button onClick={() => onNavigate("shop")} className="px-6 py-3 bg-accent-strong hover:bg-accent-hover text-white font-bold rounded-xl transition-colors">
            رفتن به فروشگاه
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="pt-20 min-h-screen bg-secondary/20">
      <div className="max-w-4xl mx-auto px-4 sm:px-8 py-10">
        <button onClick={() => onNavigate("shop")} className="flex items-center gap-2 text-muted-foreground hover:text-foreground mb-8 text-sm">
          <ChevronRight size={14} /> بازگشت به فروشگاه
        </button>

        {/* Progress */}
        <ol className="flex items-center justify-center gap-1 mb-10">
          {steps.map((s, i) => (
            <li key={i} className="flex items-center" aria-current={i + 1 === step ? "step" : undefined}>
              <span className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${i + 1 < step ? "bg-success text-white" : i + 1 === step ? "bg-accent-strong text-white" : "bg-muted text-muted-foreground"}`}>
                {i + 1 < step ? <Check size={12} /> : fa(i + 1)}
              </span>
              <span className={`hidden sm:inline text-xs mx-2 ${i + 1 === step ? "font-semibold" : "text-muted-foreground"}`}>{s}</span>
              {i < steps.length - 1 && <span className={`w-8 h-0.5 mx-1 ${i + 1 < step ? "bg-success" : "bg-muted"}`} />}
            </li>
          ))}
        </ol>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Form */}
          <div className="lg:col-span-2 bg-card rounded-2xl p-6 border border-border">
            {step === 1 && (
              <div className="space-y-4">
                <h2 className="font-bold text-xl mb-1">اطلاعات مشتری</h2>
                <p className="text-sm text-muted-foreground mb-5">
                  از حساب کاربری‌ات خوانده شده — نیازی به وارد کردن دوباره نیست.
                </p>
                <div className="rounded-2xl border border-border bg-secondary/40 p-4 space-y-3">
                  {[["نام و نام خانوادگی", form.name], ["شماره موبایل", form.phone]].map(([l, v]) => (
                    <div key={l} className="flex items-center justify-between gap-3">
                      <span className="font-medium nums">{v}</span>
                      <span className="text-sm text-muted-foreground">{l}</span>
                    </div>
                  ))}
                </div>
                <button onClick={() => onNavigate("account")} className="text-sm text-accent-strong hover:underline">
                  ویرایش در پروفایل
                </button>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <h2 className="font-bold text-xl mb-5">آدرس تحویل</h2>

                <div>
                  <label htmlFor="province" className="block text-sm font-medium mb-1.5">استان</label>
                  <Select value={form.province} onValueChange={(v) => update("province", v)}>
                    <SelectTrigger
                      id="province"
                      aria-invalid={Boolean(errors.province)}
                      aria-describedby={errors.province ? "province-error" : "province-hint"}
                      className={`w-full h-12 rounded-xl bg-secondary px-4 ${errors.province ? "border-destructive" : "border-border"}`}
                    >
                      <SelectValue placeholder="استان را انتخاب کن" />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {PROVINCES.map(p => (
                        // shadcn highlights items with bg-accent, and this theme
                        // overloads --accent with the brand terracotta (white on it
                        // is only 3.95:1) — the highlight uses accent-strong instead.
                        <SelectItem
                          key={p.name}
                          value={p.name}
                          className="focus:bg-accent-strong focus:text-white"
                        >
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.province ? (
                    <p id="province-error" className="mt-1.5 text-xs text-destructive flex items-center gap-1">
                      <AlertCircle size={12} /> {errors.province}
                    </p>
                  ) : (
                    <p id="province-hint" className="mt-1.5 text-xs text-muted-foreground">
                      هزینه ارسال بر اساس استان محاسبه می‌شود.
                    </p>
                  )}
                </div>

                <Field id="address" label="آدرس کامل" error={errors.address}>
                  {(props) => (
                    <textarea
                      {...props}
                      rows={3}
                      value={form.address}
                      onChange={(e) => update("address", e.target.value)}
                      placeholder="خیابان، کوچه، پلاک، واحد"
                    />
                  )}
                </Field>

                <Field id="postal" label="کد پستی" error={errors.postal} hint="۱۰ رقم، بدون خط تیره">
                  {(props) => (
                    <input
                      {...props}
                      inputMode="numeric"
                      dir="ltr"
                      value={form.postal}
                      onChange={(e) => update("postal", e.target.value)}
                      className={`${props.className} text-start nums`}
                    />
                  )}
                </Field>
              </div>
            )}

            {step === 3 && (
              <div>
                <h2 className="font-bold text-xl mb-5">روش پرداخت</h2>
                <RadioGroup
                  value={form.method}
                  onValueChange={(v) => update("method", v)}
                  className="gap-3"
                >
                  {[
                    { id: "zarinpal" as const, label: "پرداخت آنلاین (زرین‌پال)", sub: "انتقال به درگاه امن بانکی", icon: <CreditCard size={18} /> },
                    { id: "cod" as const, label: "پرداخت در محل", sub: "نقدی یا کارتخوان هنگام تحویل", icon: <Wallet size={18} /> },
                  ].map(o => (
                    <label
                      key={o.id}
                      htmlFor={`pay-${o.id}`}
                      className={`flex items-center gap-3 p-4 rounded-xl border-2 cursor-pointer transition-colors ${form.method === o.id ? "border-accent-strong bg-accent/5" : "border-border hover:border-accent/50"}`}
                    >
                      <RadioGroupItem
                        value={o.id}
                        id={`pay-${o.id}`}
                        className="size-5 border-2 data-[state=checked]:border-accent-strong [&_svg]:fill-accent-strong"
                      />
                      <span className="text-accent-strong">{o.icon}</span>
                      <span>
                        <span className="block font-medium">{o.label}</span>
                        <span className="block text-xs text-muted-foreground">{o.sub}</span>
                      </span>
                    </label>
                  ))}
                </RadioGroup>

                {form.method === "zarinpal" ? (
                  <div className="flex items-center gap-3 p-5 rounded-2xl bg-success-soft border border-success/30 mt-5">
                    <Shield size={20} className="text-success-strong shrink-0" />
                    <p className="text-sm">اتصال امن به درگاه زرین‌پال. اطلاعات کارت شما نزد اسموکی ذخیره نمی‌شود.</p>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 p-5 rounded-2xl bg-warning-soft border border-warning/30 mt-5">
                    <AlertCircle size={20} className="text-warning shrink-0" />
                    <p className="text-sm">مبلغ سفارش هنگام تحویل دریافت می‌شود. لطفاً در زمان ارسال در دسترس باش.</p>
                  </div>
                )}
              </div>
            )}

            {step < 3 ? (
              <button onClick={next} className="w-full mt-6 py-3.5 bg-accent-strong hover:bg-accent-hover text-white font-bold rounded-xl transition-colors">
                ادامه
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={submitting}
                className="w-full mt-6 py-3.5 bg-accent-strong hover:bg-accent-hover text-white font-bold rounded-xl transition-colors disabled:opacity-60"
              >
                {submitting
                  ? "در حال ثبت سفارش…"
                  : form.method === "zarinpal" ? "پرداخت و ثبت سفارش" : "ثبت سفارش"}
              </button>
            )}
            {step > 1 && (
              <button onClick={() => setStep(s => s - 1)} className="w-full mt-3 py-3 border-2 border-border rounded-xl font-medium hover:bg-secondary transition-colors">
                مرحله قبل
              </button>
            )}
          </div>

          {/* Summary */}
          <div className="bg-card rounded-2xl p-5 border border-border h-fit">
            <h3 className="font-bold mb-4">خلاصه سفارش</h3>
            <div className="space-y-3 mb-4">
              {cartItems.map(item => (
                <div key={item.id} className="flex gap-3 items-center">
                  <img src={item.image} alt="" className="w-12 h-12 rounded-lg object-cover bg-muted" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium line-clamp-2">{item.name}</p>
                    <p className="text-xs text-muted-foreground nums">×{fa(item.qty)}</p>
                  </div>
                  <p className="text-xs font-bold shrink-0 nums">{formatPrice(item.price * item.qty)}</p>
                </div>
              ))}
            </div>
            <div className="border-t border-border pt-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="nums">{formatPrice(total)}</span>
                <span className="text-muted-foreground">جمع اقلام</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className={fee === null ? "text-muted-foreground" : "nums"}>
                  {fee === null ? "بعد از انتخاب استان" : formatPrice(fee)}
                </span>
                <span className="text-muted-foreground">ارسال</span>
              </div>
              <div className="flex justify-between font-bold mt-2 pt-2 border-t border-border">
                <span className="nums">{formatPrice(total + (fee ?? 0))}</span>
                <span>جمع کل</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-4 leading-relaxed">
              مبلغ نهایی هنگام ثبت سفارش توسط سرور دوباره محاسبه می‌شود.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

// ─── PAYMENT RESULT ───────────────────────────────────────────────────────────
/**
 * One page, three states — the order status decides which one renders
 * ([[Design - Checkout Flow Frontend]]):
 *   success — paid (Zarinpal verified) or a confirmed COD order
 *   failed  — payment failed/cancelled; the order still exists, retry pays it
 *   pending — the customer never came back from the gateway; verification is
 *             still open, so the copy points at support rather than a retry.
 */
const DEMO_ORDER = {
  no: faDigits(10046),
  items: [
    { ...PRODUCTS[0], qty: 1 },
    { ...PRODUCTS[2], qty: 2 },
  ] as CartItem[],
  total: PRODUCTS[0].price + PRODUCTS[2].price * 2,
  fee: 25000,
  method: "zarinpal" as PaymentMethod,
};

function PaymentResultPage({ status, order: placed, onNavigate }: {
  status: ResultStatus;
  order: { no: string; items: CartItem[]; total: number; fee: number; method: PaymentMethod } | null;
  onNavigate: (page: Page, arg?: number | string) => void;
}) {
  const order = placed ?? DEMO_ORDER;
  const view = {
    success: {
      icon: <Check size={36} className="text-success-strong" />,
      ring: "bg-success-soft",
      title: order?.method === "cod" ? "سفارش ثبت شد!" : "پرداخت موفق بود!",
      sub: order?.method === "cod"
        ? "مبلغ سفارش هنگام تحویل دریافت می‌شود. پیامک تایید برایت ارسال شد."
        : "پرداخت شما با موفقیت تایید شد. پیامک تایید برایت ارسال شد.",
    },
    failed: {
      icon: <XCircle size={36} className="text-destructive" />,
      ring: "bg-destructive-soft",
      title: "پرداخت ناموفق بود",
      sub: "تراکنش از سمت بانک تایید نشد و مبلغی از حساب شما کسر نشده است. سفارش هنوز ثبت است و می‌توانی دوباره پرداخت کنی.",
    },
    pending: {
      icon: <Clock size={36} className="text-warning" />,
      ring: "bg-warning-soft",
      title: "در انتظار تایید پرداخت",
      sub: "نتیجه پرداخت هنوز از درگاه دریافت نشده است. اگر مبلغ از حسابت کم شده، تا حداکثر ۷۲ ساعت تسویه می‌شود.",
    },
  }[status];

  return (
    <main className="pt-20 min-h-screen bg-secondary/20">
      <div className="max-w-2xl mx-auto px-4 sm:px-8 py-12">
        <div className="bg-card rounded-3xl p-8 border border-border text-center">
          <div className={`w-20 h-20 rounded-full ${view.ring} flex items-center justify-center mx-auto mb-5`}>
            {view.icon}
          </div>
          <h1 className="text-2xl font-black mb-2">{view.title}</h1>
          <p className="text-muted-foreground text-sm max-w-md mx-auto mb-7 leading-relaxed">{view.sub}</p>

          {order && (
            <div className="text-start rounded-2xl border border-border overflow-hidden mb-7">
              <div className="flex items-center justify-between gap-3 p-4 bg-secondary/50 text-sm">
                <span className="nums font-bold">#{order.no}</span>
                <span className="text-muted-foreground">شماره سفارش</span>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm border-t border-border">
                <span className="nums">{jalaliDate()}</span>
                <span className="text-muted-foreground">تاریخ ثبت</span>
              </div>
              <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm border-t border-border">
                <span>{order.method === "cod" ? "پرداخت در محل" : "زرین‌پال"}</span>
                <span className="text-muted-foreground">روش پرداخت</span>
              </div>

              <div className="border-t border-border p-4 space-y-3">
                {order.items.map(item => (
                  <div key={item.id} className="flex gap-3 items-center">
                    <img src={item.image} alt="" className="w-11 h-11 rounded-lg object-cover bg-muted" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium line-clamp-1">{item.name}</p>
                      <p className="text-xs text-muted-foreground nums">×{fa(item.qty)}</p>
                    </div>
                    <p className="text-xs font-bold shrink-0 nums">{formatPrice(item.price * item.qty)}</p>
                  </div>
                ))}
              </div>

              <div className="border-t border-border p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="nums">{formatPrice(order.total)}</span>
                  <span className="text-muted-foreground">جمع اقلام</span>
                </div>
                <div className="flex justify-between">
                  <span className="nums">{formatPrice(order.fee)}</span>
                  <span className="text-muted-foreground">ارسال</span>
                </div>
                <div className="flex justify-between font-bold pt-2 border-t border-border">
                  <span className="nums">{formatPrice(order.total + order.fee)}</span>
                  <span>{status === "success" && order.method !== "cod" ? "پرداخت شده" : "مبلغ سفارش"}</span>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {status === "failed" && (
              <button
                onClick={() => onNavigate("result", "success")}
                className="px-6 py-3 bg-accent-strong hover:bg-accent-hover text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <RefreshCw size={16} /> تلاش دوباره برای پرداخت
              </button>
            )}
            {status === "pending" && (
              <a
                href="tel:+982112345678"
                className="px-6 py-3 bg-accent-strong hover:bg-accent-hover text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
              >
                <Phone size={16} /> تماس با پشتیبانی
              </a>
            )}
            <button onClick={() => onNavigate("account")} className="px-6 py-3 border-2 border-border rounded-xl font-medium hover:bg-secondary transition-colors">
              سفارش‌های من
            </button>
            <button onClick={() => onNavigate("shop")} className="px-6 py-3 border-2 border-border rounded-xl font-medium hover:bg-secondary transition-colors">
              ادامه خرید
            </button>
          </div>
        </div>

        {status !== "success" && (
          <p className="text-center text-xs text-muted-foreground mt-6">
            شماره پشتیبانی: <span dir="ltr" className="nums">۰۲۱-۱۲۳۴۵۶۷۸</span> — هر روز ۹ تا ۱۸
          </p>
        )}
      </div>
    </main>
  );
}

// ─── ACCOUNT PAGE ─────────────────────────────────────────────────────────────
function AccountPage({ args, onNavigate }: {
  args: string[];
  onNavigate: (page: Page, ...args: (string | number)[]) => void;
}) {
  // #/account · #/account/pets · #/account/orders/10042
  const [tab = "orders", orderId] = args;
  const setTab = (t: string) => onNavigate("account", t);
  const [pets, setPets] = useState<Pet[]>([
    { id: 1, name: "لونا", type: "cat", breed: "ایرانی", age: "۳ سال", weight: "۴ کیلو", gender: "female", neutered: true }
  ]);
  const [addingPet, setAddingPet] = useState(false);
  const [petError, setPetError] = useState<string | undefined>();
  const [newPet, setNewPet] = useState<Partial<Pet>>({ type: "cat", gender: "female", neutered: false });

  const tabs = [
    { id: "orders", label: "سفارش‌ها", icon: <Package size={16} /> },
    { id: "wishlist", label: "علاقه‌مندی‌ها", icon: <Heart size={16} /> },
    { id: "pets", label: "حیوانات من", icon: <span className="text-base">🐾</span> },
    { id: "addresses", label: "آدرس‌ها", icon: <MapPin size={16} /> },
    { id: "profile", label: "پروفایل", icon: <User size={16} /> },
  ];

  // Owner-scoped: only this customer's orders ([[Smokey Shop Info]] access control).
  const orders = ORDERS.filter(o => o.customer === "سارا محمدی");
  const detailOrder = orders.find(o => o.id === orderId);

  function addPet() {
    if (!newPet.name) { setPetError("نام حیوان خانگی الزامی است."); return; }
    setPetError(undefined);
    setPets(prev => [...prev, { ...newPet, id: Date.now() } as Pet]);
    setAddingPet(false);
    setNewPet({ type: "cat", gender: "female", neutered: false });
  }

  return (
    <main className="pt-20 min-h-screen">
      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-10">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-14 h-14 rounded-full bg-secondary flex items-center justify-center text-2xl">👤</div>
          <div>
            <p className="font-bold text-xl">سارا محمدی</p>
            <p className="text-muted-foreground text-sm nums" dir="ltr">۰۹۱۲۰۰۰۰۰۰۰</p>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-8">
          {/* Sidebar */}
          <aside className="lg:w-52 shrink-0">
            <nav className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-x-visible pb-2 lg:pb-0">
              {tabs.map(t => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`flex items-center gap-2.5 px-4 py-3 rounded-xl text-sm font-medium whitespace-nowrap transition-colors shrink-0 ${tab === t.id ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}>
                  {t.icon} {t.label}
                </button>
              ))}
            </nav>
          </aside>

          {/* Content */}
          <div className="flex-1">
            {tab === "orders" && detailOrder && (
              <CustomerOrderDetail
                order={detailOrder}
                onNavigate={onNavigate}
                onBack={() => onNavigate("account", "orders")}
              />
            )}

            {tab === "orders" && !detailOrder && (
              <div>
                <h2 className="font-bold text-xl mb-5">سفارش‌های من</h2>
                {orders.length === 0 && (
                  <div className="bg-secondary/40 rounded-2xl py-16 text-center">
                    <Package size={40} className="mx-auto mb-3 text-muted-foreground" />
                    <p className="font-semibold mb-1">هنوز سفارشی ثبت نکرده‌ای</p>
                    <p className="text-sm text-muted-foreground">اولین سفارشت اینجا نمایش داده می‌شود.</p>
                  </div>
                )}
                <div className="space-y-3">
                  {orders.map(o => (
                    <a
                      key={o.id}
                      href={`#/account/orders/${o.id}`}
                      onClick={e => { e.preventDefault(); onNavigate("account", "orders", o.id); }}
                      className="bg-card rounded-xl p-5 border border-border flex items-center justify-between flex-wrap gap-3 transition-[border-color,box-shadow] hover:border-accent-strong hover:shadow-sm"
                    >
                      <div className="flex items-center gap-2 text-sm text-accent-strong font-medium">
                        <ChevronLeft size={14} /> جزئیات سفارش
                      </div>
                      <div className="flex items-center gap-5 flex-wrap">
                        <div className="text-end">
                          <span className={`inline-block text-xs px-3 py-1 rounded-full font-medium ${ORDER_STATUS[o.status].badge}`}>{ORDER_STATUS[o.status].label}</span>
                          <p className="text-sm font-bold mt-1 nums">{formatPrice(orderTotals(o).total)}</p>
                        </div>
                        <div className="text-end">
                          <p className="font-semibold nums">سفارش #{faDigits(o.id)}</p>
                          <p className="text-sm text-muted-foreground">{o.date} · {fa(o.lines.length)} قلم</p>
                        </div>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {tab === "pets" && (
              <div>
                <div className="flex items-center justify-between mb-5">
                  <h2 className="font-bold text-xl">حیوانات من</h2>
                  <button onClick={() => setAddingPet(true)} className="flex items-center gap-2 px-4 py-2 bg-accent-strong text-white font-medium rounded-xl text-sm hover:bg-accent-hover transition-colors">
                    <Plus size={14} /> افزودن
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                  {pets.map(p => (
                    <div key={p.id} className="bg-card rounded-2xl p-5 border border-border">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center text-2xl">
                          {p.type === "cat" ? "🐱" : "🐶"}
                        </div>
                        <div>
                          <p className="font-bold">{p.name}</p>
                          <p className="text-sm text-muted-foreground">{p.breed}</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        {[["سن", p.age], ["وزن", p.weight], ["جنس", p.gender === "female" ? "ماده" : "نر"], ["عقیم‌شده", p.neutered ? "بله" : "خیر"]].map(([k, v]) => (
                          <div key={k} className="bg-secondary/50 rounded-lg p-2.5">
                            <p className="text-xs text-muted-foreground">{k}</p>
                            <p className="font-medium">{v}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                {addingPet && (
                  <div className="bg-card rounded-2xl p-6 border-2 border-accent/30">
                    <h3 className="font-bold mb-4">افزودن حیوان جدید</h3>

                    {/* Optional photo — Pet.image existed in the type with no control */}
                    <div className="flex items-center gap-4 mb-5">
                      <div className="w-16 h-16 rounded-full bg-secondary flex items-center justify-center text-2xl shrink-0">
                        {newPet.type === "cat" ? "🐱" : "🐶"}
                      </div>
                      <div>
                        <label
                          htmlFor="pet-photo"
                          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-border text-sm font-medium cursor-pointer hover:bg-secondary transition-colors"
                        >
                          <Camera size={14} /> انتخاب عکس
                        </label>
                        <input id="pet-photo" type="file" accept="image/*" className="sr-only" />
                        <p className="text-xs text-muted-foreground mt-1.5">اختیاری — JPG یا PNG تا ۲ مگابایت</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {[["name", "نام"], ["breed", "نژاد"], ["age", "سن"], ["weight", "وزن"]].map(([k, l]) => (
                        <Field
                          key={k}
                          id={`pet-${k}`}
                          label={l}
                          error={k === "name" && petError ? petError : undefined}
                        >
                          {(props) => (
                            <input
                              {...props}
                              value={(newPet as any)[k] || ""}
                              onChange={e => { setNewPet(prev => ({ ...prev, [k]: e.target.value })); if (k === "name") setPetError(undefined); }}
                              className={`${props.className} py-2.5`}
                            />
                          )}
                        </Field>
                      ))}
                      <div>
                        <label className="block text-sm font-medium mb-1.5">نوع</label>
                        <div className="flex gap-2">
                          {[{ v: "cat", l: "🐱 گربه" }, { v: "dog", l: "🐶 سگ" }].map(o => (
                            <button key={o.v} onClick={() => setNewPet(prev => ({ ...prev, type: o.v as "cat" | "dog" }))}
                              className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-medium transition-colors ${newPet.type === o.v ? "border-accent-strong bg-accent/10 text-accent-strong" : "border-border"}`}>{o.l}</button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium mb-1.5">جنس</label>
                        <div className="flex gap-2">
                          {[{ v: "female", l: "ماده" }, { v: "male", l: "نر" }].map(o => (
                            <button key={o.v} onClick={() => setNewPet(prev => ({ ...prev, gender: o.v as "male" | "female" }))}
                              className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-medium transition-colors ${newPet.gender === o.v ? "border-accent-strong bg-accent/10 text-accent-strong" : "border-border"}`}>{o.l}</button>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-3 mt-5">
                      <button onClick={addPet} className="flex-1 py-3 bg-accent-strong text-white font-bold rounded-xl hover:bg-accent-hover transition-colors">ذخیره</button>
                      <button onClick={() => setAddingPet(false)} className="px-5 py-3 border-2 border-border rounded-xl font-medium hover:bg-secondary transition-colors">انصراف</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === "wishlist" && (
              <div>
                <h2 className="font-bold text-xl mb-5">علاقه‌مندی‌ها</h2>
                <p className="text-muted-foreground">هنوز محصولی به علاقه‌مندی‌ها اضافه نشده.</p>
              </div>
            )}

            {tab === "addresses" && (
              <div>
                <div className="flex items-center justify-between mb-5">
                  <h2 className="font-bold text-xl">آدرس‌های من</h2>
                  <button className="flex items-center gap-2 px-4 py-2.5 bg-accent-strong text-white font-medium rounded-xl text-sm hover:bg-accent-hover transition-colors">
                    <Plus size={14} /> آدرس جدید
                  </button>
                </div>
                <div className="space-y-3">
                  {[
                    { title: "خانه", province: "تهران", line: "خیابان ولیعصر، پلاک ۱۲، واحد ۳", postal: "۱۵۱۱۵۳۴۵۶", default: true },
                    { title: "محل کار", province: "البرز", line: "کرج، بلوار طالقانی، پلاک ۴۵", postal: "۳۱۹۷۶۵۴۳۲", default: false },
                  ].map(a => (
                    <div key={a.title} className="bg-card rounded-xl p-5 border border-border flex items-start justify-between gap-4 flex-wrap">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <p className="font-semibold">{a.title} — {a.province}</p>
                          {a.default && <span className="text-xs px-2 py-0.5 rounded-full bg-success-soft text-success-strong font-medium">پیش‌فرض</span>}
                        </div>
                        <p className="text-sm text-muted-foreground">{a.line}</p>
                        <p className="text-sm text-muted-foreground nums">کد پستی: {a.postal}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button aria-label={`ویرایش آدرس ${a.title}`} className="w-10 h-10 rounded-lg hover:bg-secondary flex items-center justify-center transition-colors"><Edit size={14} /></button>
                        <button aria-label={`حذف آدرس ${a.title}`} className="w-10 h-10 rounded-lg hover:bg-destructive-soft text-destructive flex items-center justify-center transition-colors"><Trash2 size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tab === "profile" && (
              <div>
                <h2 className="font-bold text-xl mb-5">پروفایل</h2>
                <div className="bg-card rounded-2xl p-6 border border-border space-y-4">
                  {[
                    { label: "نام و نام خانوادگی", value: "سارا محمدی" },
                    { label: "شماره موبایل", value: "۰۹۱۲۰۰۰۰۰۰۰", readOnly: true, hint: "شماره ورود شماست و از این صفحه تغییر نمی‌کند." },
                    { label: "ایمیل (اختیاری)", value: "" },
                  ].map((f, i) => (
                    <div key={f.label}>
                      <label htmlFor={`profile-${i}`} className="block text-sm font-medium mb-1.5 text-muted-foreground">{f.label}</label>
                      <input
                        id={`profile-${i}`}
                        defaultValue={f.value}
                        readOnly={f.readOnly}
                        dir={f.readOnly ? "ltr" : undefined}
                        className={`w-full px-4 py-3 rounded-xl bg-secondary border border-border text-start outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-accent-strong ${f.readOnly ? "text-muted-foreground text-start nums" : ""}`}
                      />
                      {f.hint && <p className="mt-1.5 text-xs text-muted-foreground">{f.hint}</p>}
                    </div>
                  ))}
                  <button className="mt-2 px-6 py-3 bg-accent-strong text-white font-bold rounded-xl hover:bg-accent-hover transition-colors">
                    ذخیره تغییرات
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

// ─── ADMIN: PRODUCT FORM ──────────────────────────────────────────────────────
/**
 * Create / edit one product. Fields mirror [[Story - Product Catalog Schema]]:
 * title, slug, sku, brand, description, benefit, price + old price (integer
 * Toman), stock, category, pet type, is_active, and the image slot. Validation
 * reuses the shared `Field` error pattern.
 */
function AdminProductForm({ productId, onDone }: { productId?: number; onDone: () => void }) {
  const existing = PRODUCTS.find(p => p.id === productId);
  const [form, setForm] = useState({
    title: existing?.name ?? "",
    slug: existing ? `product-${existing.id}` : "",
    sku: existing?.sku ?? "",
    brand: existing?.brand ?? "",
    description: existing ? "توضیح کامل محصول برای صفحه محصول." : "",
    benefit: existing?.benefit ?? "",
    price: existing ? String(existing.price) : "",
    oldPrice: existing?.oldPrice ? String(existing.oldPrice) : "",
    stock: existing ? String(existing.stock) : "",
    category: existing?.category ?? "",
    pet: (existing?.pet ?? "cat") as "cat" | "dog",
    isActive: true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  function update(k: string, v: string | boolean) {
    setForm(f => ({ ...f, [k]: v }));
    setErrors(e => ({ ...e, [k]: "" }));
  }

  function save() {
    const e: Record<string, string> = {};
    if (form.title.trim().length < 3) e.title = "عنوان محصول الزامی است.";
    if (!/^[a-z0-9-]{3,}$/.test(form.slug)) e.slug = "نشانی فقط با حروف کوچک انگلیسی، عدد و خط تیره.";
    if (!form.sku.trim()) e.sku = "کد کالا (SKU) الزامی است — روی اقلام سفارش ثبت می‌شود.";
    if (!form.category) e.category = "دسته‌بندی را انتخاب کن.";
    if (!/^\d+$/.test(form.price) || Number(form.price) <= 0) e.price = "قیمت باید عددی صحیح و بزرگ‌تر از صفر باشد (تومان).";
    if (form.oldPrice && (!/^\d+$/.test(form.oldPrice) || Number(form.oldPrice) <= Number(form.price)))
      e.oldPrice = "قیمت قبلی باید از قیمت فعلی بیشتر باشد.";
    if (!/^\d+$/.test(form.stock)) e.stock = "موجودی باید عددی صحیح و صفر یا بیشتر باشد.";
    setErrors(e);
    if (Object.keys(e).length === 0) onDone();
  }

  const money = (v: string) => (/^\d+$/.test(v) ? `${formatPrice(Number(v))}` : null);

  return (
    <div className="max-w-3xl">
      <button onClick={onDone} className="flex items-center gap-2 text-muted-foreground hover:text-foreground mb-5 text-sm">
        <ChevronRight size={14} /> بازگشت به فهرست محصولات
      </button>
      <h1 className="text-2xl font-black mb-6">{existing ? "ویرایش محصول" : "محصول جدید"}</h1>

      <div className="bg-white rounded-2xl border border-border p-6 space-y-5">
        {/* Image slot — bundled local images; uploads go to object storage on the server */}
        <div>
          <p className="block text-sm font-medium mb-1.5">تصویر محصول</p>
          <div className="flex items-center gap-4">
            <div className="w-24 h-24 rounded-xl bg-secondary overflow-hidden flex items-center justify-center shrink-0">
              {existing
                ? <img src={existing.image} alt="" className="w-full h-full object-cover" />
                : <Camera size={22} className="text-muted-foreground" />}
            </div>
            <div>
              <label htmlFor="product-image" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-border text-sm font-medium cursor-pointer hover:bg-secondary transition-colors">
                <Camera size={14} /> {existing ? "تغییر تصویر" : "انتخاب تصویر"}
              </label>
              <input id="product-image" type="file" accept="image/*" className="sr-only" />
              <p className="text-xs text-muted-foreground mt-1.5">JPG یا PNG، حداقل ۸۰۰×۸۰۰ پیکسل، تا ۲ مگابایت</p>
            </div>
          </div>
        </div>

        <Field id="title" label="عنوان محصول" error={errors.title}>
          {(props) => <input {...props} value={form.title} onChange={e => update("title", e.target.value)} />}
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field id="slug" label="نشانی یکتا (slug)" error={errors.slug} hint="در آدرس صفحه محصول استفاده می‌شود">
            {(props) => (
              <input {...props} dir="ltr" value={form.slug} onChange={e => update("slug", e.target.value)}
                placeholder="royal-canin-adult-cat" className={`${props.className} text-start`} />
            )}
          </Field>
          <Field id="sku" label="کد کالا (SKU)" error={errors.sku} hint="روی اقلام سفارش ثبت (snapshot) می‌شود">
            {(props) => (
              <input {...props} dir="ltr" value={form.sku} onChange={e => update("sku", e.target.value)}
                className={`${props.className} text-start`} />
            )}
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field id="brand" label="برند" error={errors.brand}>
            {(props) => <input {...props} value={form.brand} onChange={e => update("brand", e.target.value)} />}
          </Field>
          <div>
            <label htmlFor="category" className="block text-sm font-medium mb-1.5">دسته‌بندی</label>
            <Select value={form.category} onValueChange={v => update("category", v)}>
              <SelectTrigger
                id="category"
                aria-invalid={Boolean(errors.category)}
                aria-describedby={errors.category ? "category-error" : undefined}
                className={`w-full h-12 rounded-xl bg-secondary px-4 ${errors.category ? "border-destructive" : "border-border"}`}
              >
                <SelectValue placeholder="انتخاب دسته‌بندی" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(c => (
                  <SelectItem key={c} value={c} className="focus:bg-accent-strong focus:text-white">{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.category && (
              <p id="category-error" className="mt-1.5 text-xs text-destructive flex items-center gap-1">
                <AlertCircle size={12} /> {errors.category}
              </p>
            )}
          </div>
        </div>

        <Field id="benefit" label="جمله مزیت" error={errors.benefit} hint="یک خط کوتاه که روی کارت محصول دیده می‌شود">
          {(props) => <input {...props} value={form.benefit} onChange={e => update("benefit", e.target.value)} placeholder="مناسب گوارش حساس" />}
        </Field>

        <Field id="description" label="توضیحات" error={errors.description}>
          {(props) => <textarea {...props} rows={4} value={form.description} onChange={e => update("description", e.target.value)} />}
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field id="price" label="قیمت (تومان)" error={errors.price} hint={money(form.price) ?? "عدد صحیح، بدون جداکننده"}>
            {(props) => (
              <input {...props} inputMode="numeric" dir="ltr" value={form.price}
                onChange={e => update("price", e.target.value)} className={`${props.className} text-start nums`} />
            )}
          </Field>
          <Field id="oldPrice" label="قیمت قبلی (اختیاری)" error={errors.oldPrice} hint={money(form.oldPrice) ?? "برای نمایش برچسب تخفیف"}>
            {(props) => (
              <input {...props} inputMode="numeric" dir="ltr" value={form.oldPrice}
                onChange={e => update("oldPrice", e.target.value)} className={`${props.className} text-start nums`} />
            )}
          </Field>
          <Field id="stock" label="موجودی" error={errors.stock} hint="صفر یعنی ناموجود">
            {(props) => (
              <input {...props} inputMode="numeric" dir="ltr" value={form.stock}
                onChange={e => update("stock", e.target.value)} className={`${props.className} text-start nums`} />
            )}
          </Field>
        </div>

        <fieldset>
          <legend className="block text-sm font-medium mb-1.5">نوع حیوان</legend>
          <div className="flex gap-2 max-w-xs">
            {[{ v: "cat" as const, l: "🐱 گربه" }, { v: "dog" as const, l: "🐶 سگ" }].map(o => (
              <button
                key={o.v}
                type="button"
                onClick={() => update("pet", o.v)}
                aria-pressed={form.pet === o.v}
                className={`flex-1 py-2.5 rounded-xl border-2 text-sm font-medium transition-colors ${form.pet === o.v ? "border-accent-strong bg-accent/10 text-accent-strong" : "border-border hover:border-accent-strong"}`}
              >
                {o.l}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="flex items-start gap-3 p-4 rounded-xl bg-secondary/50 border border-border">
          <Checkbox
            id="isActive"
            checked={form.isActive}
            onCheckedChange={v => update("isActive", Boolean(v))}
            className="mt-0.5 data-[state=checked]:bg-accent-strong data-[state=checked]:border-accent-strong"
          />
          <div>
            <label htmlFor="isActive" className="font-medium cursor-pointer">نمایش در فروشگاه</label>
            <p className="text-xs text-muted-foreground mt-0.5">
              محصولات حذف‌شده فقط غیرفعال می‌شوند تا سفارش‌های قبلی سالم بمانند.
            </p>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button onClick={save} className="px-6 py-3 bg-accent-strong hover:bg-accent-hover text-white font-bold rounded-xl transition-colors">
            ذخیره محصول
          </button>
          <button onClick={onDone} className="px-5 py-3 border-2 border-border rounded-xl font-medium hover:bg-secondary transition-colors">
            انصراف
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ADMIN: ORDER DETAIL ──────────────────────────────────────────────────────
/** Order summary rows, shared by the admin and customer detail views. */
function OrderSummaryTable({ order }: { order: Order }) {
  const { subtotal, fee, total } = orderTotals(order);
  return (
    <>
      <div className="divide-y divide-border">
        {orderLines(order).map(item => (
          <div key={item.id} className="flex gap-3 items-center py-3">
            <img src={item.image} alt="" className="w-12 h-12 rounded-lg object-cover bg-muted shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium line-clamp-1">{item.name}</p>
              <p className="text-xs text-muted-foreground nums" dir="ltr">{item.sku}</p>
            </div>
            <p className="text-xs text-muted-foreground nums shrink-0">{fa(item.qty)} × {formatPrice(item.price)}</p>
            <p className="text-sm font-bold shrink-0 nums w-28 text-end">{formatPrice(item.price * item.qty)}</p>
          </div>
        ))}
      </div>
      <div className="border-t border-border pt-3 mt-1 space-y-2 text-sm">
        <div className="flex justify-between"><span className="nums">{formatPrice(subtotal)}</span><span className="text-muted-foreground">جمع اقلام</span></div>
        <div className="flex justify-between"><span className="nums">{formatPrice(fee)}</span><span className="text-muted-foreground">هزینه ارسال ({order.province})</span></div>
        <div className="flex justify-between font-bold pt-2 border-t border-border"><span className="nums">{formatPrice(total)}</span><span>جمع کل</span></div>
      </div>
    </>
  );
}

function AdminOrderDetail({ order, onDone }: { order: Order; onDone: () => void }) {
  const [status, setStatus] = useState<string>(order.status);
  const next = ADMIN_TRANSITIONS[status] ?? [];

  return (
    <div className="max-w-4xl">
      <button onClick={onDone} className="flex items-center gap-2 text-muted-foreground hover:text-foreground mb-5 text-sm">
        <ChevronRight size={14} /> بازگشت به فهرست سفارش‌ها
      </button>

      <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
        <span className={`text-xs px-3 py-1.5 rounded-full font-medium ${ORDER_STATUS[status].badge}`}>
          {ORDER_STATUS[status].label}
        </span>
        <div className="text-end">
          <h1 className="text-2xl font-black nums">سفارش #{faDigits(order.id)}</h1>
          <p className="text-sm text-muted-foreground">{order.date}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <section className="bg-white rounded-2xl border border-border p-5">
            <h2 className="font-bold mb-3">اقلام سفارش</h2>
            <p className="text-xs text-muted-foreground mb-2">
              عنوان، SKU و قیمت واحد در زمان ثبت سفارش ذخیره شده‌اند و با تغییر محصول عوض نمی‌شوند.
            </p>
            <OrderSummaryTable order={order} />
          </section>

          {/* Status transitions constrained to the state machine */}
          <section className="bg-white rounded-2xl border border-border p-5">
            <h2 className="font-bold mb-1">تغییر وضعیت</h2>
            <p className="text-xs text-muted-foreground mb-4">
              فقط وضعیت‌های مجاز بعدی نمایش داده می‌شوند. «پرداخت شده» و «ناموفق» را درگاه تعیین می‌کند، نه اپراتور.
            </p>
            {next.length === 0 ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Check size={14} className="text-success-strong" />
                این سفارش در وضعیت نهایی «{ORDER_STATUS[status].label}» است و تغییر دیگری ندارد.
              </p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {next.map(t => (
                  <button
                    key={t}
                    onClick={() => setStatus(t)}
                    className={`px-5 py-2.5 rounded-xl font-medium text-sm transition-colors ${
                      t === "cancelled"
                        ? "border-2 border-destructive/40 text-destructive hover:bg-destructive-soft"
                        : "bg-accent-strong hover:bg-accent-hover text-white"
                    }`}
                  >
                    {t === "cancelled" ? "لغو سفارش" : `تغییر به «${ORDER_STATUS[t].label}»`}
                  </button>
                ))}
              </div>
            )}
            {next.includes("cancelled") && (
              <p className="text-xs text-warning mt-4 flex items-start gap-1.5">
                <AlertCircle size={12} className="shrink-0 mt-0.5" />
                لغو سفارش موجودی اقلام را برمی‌گرداند؛ اگر پرداخت انجام شده باشد بازپرداخت دستی لازم است.
              </p>
            )}
          </section>
        </div>

        <div className="space-y-5">
          <section className="bg-white rounded-2xl border border-border p-5">
            <h2 className="font-bold mb-3">مشتری</h2>
            <p className="font-medium">{order.customer}</p>
            <p className="text-sm text-muted-foreground nums" dir="ltr">{faDigits(order.phone)}</p>
          </section>

          <section className="bg-white rounded-2xl border border-border p-5">
            <h2 className="font-bold mb-3">آدرس تحویل</h2>
            <p className="text-sm font-medium mb-1">{order.province}</p>
            <p className="text-sm text-muted-foreground leading-relaxed">{order.address}</p>
            <p className="text-sm text-muted-foreground nums mt-1">کد پستی: {faDigits(order.postal)}</p>
          </section>

          <section className="bg-white rounded-2xl border border-border p-5">
            <h2 className="font-bold mb-3">پرداخت</h2>
            <div className="space-y-2.5 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">{order.method === "cod" ? "پرداخت در محل" : "زرین‌پال"}</span>
                <span className="text-muted-foreground">روش</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${PAYMENT_STATUS[order.payment].badge}`}>
                  {PAYMENT_STATUS[order.payment].label}
                </span>
                <span className="text-muted-foreground">وضعیت</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="nums" dir="ltr">{order.ref ? faDigits(order.ref) : "—"}</span>
                <span className="text-muted-foreground">کد پیگیری</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ─── ADMIN: SHIPPING RATES ────────────────────────────────────────────────────
/** Fee per province, integer Toman ([[Story - Province Shipping Rates]]). */
function AdminShippingRates() {
  const [rates, setRates] = useState(() => Object.fromEntries(PROVINCES.map(p => [p.name, String(p.fee)])));
  const [saved, setSaved] = useState(false);

  const invalid = Object.entries(rates).filter(([, v]) => !/^\d+$/.test(v) || Number(v) <= 0).map(([k]) => k);

  return (
    <div className="max-w-3xl">
      <div className="flex items-end justify-between flex-wrap gap-3 mb-2">
        <button
          onClick={() => { if (invalid.length === 0) { setSaved(true); setTimeout(() => setSaved(false), 2500); } }}
          disabled={invalid.length > 0}
          className="px-5 py-2.5 bg-accent-strong hover:bg-accent-hover text-white font-medium rounded-xl text-sm transition-colors disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
        >
          ذخیره نرخ‌ها
        </button>
        <div>
          <h1 className="text-2xl font-black">نرخ ارسال استان‌ها</h1>
          <p className="text-sm text-muted-foreground mt-1">
            هزینه ارسال هر استان به تومان. مبلغ هنگام ثبت سفارش روی خود سفارش ذخیره می‌شود.
          </p>
        </div>
      </div>

      {saved && (
        <p className="flex items-center gap-2 text-sm text-success-strong bg-success-soft rounded-xl px-4 py-3 my-4">
          <Check size={16} /> نرخ‌های {fa(PROVINCES.length)} استان ذخیره شد.
        </p>
      )}
      {invalid.length > 0 && (
        <p className="flex items-center gap-2 text-sm text-destructive bg-destructive-soft rounded-xl px-4 py-3 my-4">
          <AlertCircle size={16} /> نرخ {invalid.length === 1 ? `استان ${invalid[0]}` : `${fa(invalid.length)} استان`} معتبر نیست — عدد صحیح و بزرگ‌تر از صفر لازم است.
        </p>
      )}

      <div className="bg-white rounded-2xl border border-border overflow-hidden mt-4">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50">
            <tr>
              <th className="text-start px-4 py-3 font-semibold text-muted-foreground">استان</th>
              <th className="text-start px-4 py-3 font-semibold text-muted-foreground">هزینه ارسال (تومان)</th>
              <th className="text-start px-4 py-3 font-semibold text-muted-foreground">پیش‌نمایش</th>
            </tr>
          </thead>
          <tbody>
            {PROVINCES.map(p => {
              const v = rates[p.name];
              const bad = !/^\d+$/.test(v) || Number(v) <= 0;
              return (
                <tr key={p.name} className="border-t border-border">
                  <td className="px-4 py-2.5 font-medium">{p.name}</td>
                  <td className="px-4 py-2.5">
                    <label htmlFor={`rate-${p.name}`} className="sr-only">هزینه ارسال {p.name}</label>
                    <input
                      id={`rate-${p.name}`}
                      inputMode="numeric"
                      dir="ltr"
                      aria-invalid={bad}
                      value={v}
                      onChange={e => setRates(r => ({ ...r, [p.name]: e.target.value }))}
                      className={`w-36 px-3 py-2 rounded-lg bg-secondary border text-start nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${bad ? "border-destructive bg-destructive-soft/40" : "border-border focus-visible:border-accent-strong"}`}
                    />
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground nums">
                    {bad ? <span className="text-destructive">نامعتبر</span> : formatPrice(Number(v))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── CUSTOMER: ORDER DETAIL ───────────────────────────────────────────────────
function CustomerOrderDetail({ order, onNavigate, onBack }: {
  order: Order;
  onNavigate: (page: Page, ...args: (string | number)[]) => void;
  onBack: () => void;
}) {
  const canRetry = order.status === "pending_payment";
  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-2 text-muted-foreground hover:text-foreground mb-5 text-sm">
        <ChevronRight size={14} /> بازگشت به سفارش‌ها
      </button>

      <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
        <span className={`text-xs px-3 py-1.5 rounded-full font-medium ${ORDER_STATUS[order.status].badge}`}>
          {ORDER_STATUS[order.status].label}
        </span>
        <div className="text-end">
          <h2 className="font-bold text-xl nums">سفارش #{faDigits(order.id)}</h2>
          <p className="text-sm text-muted-foreground">{order.date}</p>
        </div>
      </div>

      {canRetry && (
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-warning-soft border border-warning/30 mb-5">
          <Clock size={18} className="text-warning shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-semibold">این سفارش هنوز پرداخت نشده است</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              اقلام برایت نگه داشته شده‌اند؛ می‌توانی همین حالا پرداخت را کامل کنی.
            </p>
          </div>
          <button
            onClick={() => onNavigate("result", "pending")}
            className="px-5 py-2.5 bg-accent-strong hover:bg-accent-hover text-white font-bold rounded-xl text-sm transition-colors shrink-0 flex items-center gap-2"
          >
            <RefreshCw size={14} /> پرداخت مجدد
          </button>
        </div>
      )}

      <div className="bg-card rounded-2xl border border-border p-5 mb-5">
        <h3 className="font-bold mb-3">اقلام سفارش</h3>
        <OrderSummaryTable order={order} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div className="bg-card rounded-2xl border border-border p-5">
          <h3 className="font-bold mb-3">آدرس تحویل</h3>
          <p className="text-sm font-medium mb-1">{order.province}</p>
          <p className="text-sm text-muted-foreground leading-relaxed">{order.address}</p>
          <p className="text-sm text-muted-foreground nums mt-1">کد پستی: {faDigits(order.postal)}</p>
        </div>
        <div className="bg-card rounded-2xl border border-border p-5">
          <h3 className="font-bold mb-3">پرداخت</h3>
          <div className="space-y-2.5 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium">{order.method === "cod" ? "پرداخت در محل" : "زرین‌پال"}</span>
              <span className="text-muted-foreground">روش</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${PAYMENT_STATUS[order.payment].badge}`}>
                {PAYMENT_STATUS[order.payment].label}
              </span>
              <span className="text-muted-foreground">وضعیت</span>
            </div>
            {order.ref && (
              <div className="flex items-center justify-between gap-3">
                <span className="nums" dir="ltr">{faDigits(order.ref)}</span>
                <span className="text-muted-foreground">کد پیگیری</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── ADMIN PAGE ───────────────────────────────────────────────────────────────
function AdminPage({ args, onNavigate }: {
  args: string[];
  onNavigate: (page: Page, ...args: (string | number)[]) => void;
}) {
  // #/admin-panel · #/admin-panel/orders · #/admin-panel/orders/10045 · #/admin-panel/products/new · #/admin-panel/settings
  const [adminTab = "dashboard", detailId] = args;
  const setAdminTab = (t: string) => onNavigate("admin-panel", t);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const detailOrder = ORDERS.find(o => o.id === detailId);

  const metrics = [
    { label: "فروش امروز", value: (12450000).toLocaleString("fa-IR"), sub: "+۱۸٪ نسبت به دیروز", icon: <TrendingUp size={18} />, color: "text-success-strong" },
    { label: "تعداد سفارش‌ها", value: (47).toLocaleString("fa-IR"), sub: "۸ سفارش جدید", icon: <ShoppingCart size={18} />, color: "text-accent-strong" },
    { label: "مشتریان جدید", value: (12).toLocaleString("fa-IR"), sub: "این هفته", icon: <Users size={18} />, color: "text-tan-strong" },
    { label: "میانگین سفارش", value: (264800).toLocaleString("fa-IR"), sub: "تومان", icon: <BarChart2 size={18} />, color: "text-accent-strong" },
  ];

  const alerts = [
    { text: "۸ سفارش آماده ارسال", color: "text-accent-strong", icon: <Package size={14} /> },
    { text: "۴ محصول در حال اتمام موجودی", color: "text-warning", icon: <AlertCircle size={14} /> },
    { text: "۳ نظر نیازمند بررسی", color: "text-info", icon: <MessageSquare size={14} /> },
    { text: "۲ پرداخت ناموفق", color: "text-destructive", icon: <CreditCard size={14} /> },
  ];

  const navItems = [
    { id: "dashboard", label: "داشبورد", icon: <Home size={16} /> },
    { id: "orders", label: "سفارش‌ها", icon: <ShoppingCart size={16} /> },
    { id: "products", label: "محصولات", icon: <Package size={16} /> },
    { id: "customers", label: "مشتریان", icon: <Users size={16} /> },
    { id: "content", label: "محتوا", icon: <FileText size={16} /> },
    { id: "discounts", label: "تخفیف‌ها", icon: <Tag size={16} /> },
    { id: "reports", label: "گزارش‌ها", icon: <PieChart size={16} /> },
    { id: "settings", label: "نرخ ارسال", icon: <Settings size={16} /> },
  ];

  return (
    <div className="flex h-screen bg-background overflow-hidden" dir="rtl" lang="fa">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? "w-56" : "w-16"} bg-ink flex flex-col transition-[width] duration-300 shrink-0`}>
        <div className="p-4 border-b border-white/10 flex items-center gap-3">
          <button onClick={() => setSidebarOpen(o => !o)} aria-label={sidebarOpen ? "جمع کردن منوی کناری" : "باز کردن منوی کناری"} aria-expanded={sidebarOpen} className="w-10 h-10 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors text-white">
            <Menu size={14} />
          </button>
          {sidebarOpen && <span className="text-white font-black">Smokey</span>}
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map(item => (
            <button key={item.id} onClick={() => setAdminTab(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${adminTab === item.id ? "bg-accent-strong text-white" : "text-white/70 hover:bg-white/10 hover:text-white"}`}>
              {item.icon}
              {sidebarOpen && <span>{item.label}</span>}
            </button>
          ))}
        </nav>

        <div className="p-3 border-t border-white/10">
          <button onClick={() => onNavigate("home")}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-white/60 hover:bg-white/10 hover:text-white transition-colors">
            <LogOut size={16} />
            {sidebarOpen && <span>خروج از پنل</span>}
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top bar */}
        <header className="bg-white border-b border-border px-6 py-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <button aria-label="اعلان‌ها (خوانده‌نشده)" className="relative w-10 h-10 rounded-full hover:bg-secondary flex items-center justify-center">
              <Bell size={18} />
              <span className="absolute top-1 start-1 w-2 h-2 bg-accent-strong rounded-full" />
            </button>
            <span className="text-sm text-muted-foreground">پنل مدیریت اسموکی</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center text-sm font-bold">م</div>
            <span className="text-sm font-medium hidden sm:inline">مدیر</span>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {adminTab === "dashboard" && (
            <div>
              <h1 className="text-2xl font-black mb-6">داشبورد</h1>

              {/* Metrics */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                {metrics.map((m, i) => (
                  <div key={i} className="bg-white rounded-2xl p-5 border border-border">
                    <div className={`w-9 h-9 rounded-xl bg-secondary flex items-center justify-center mb-3 ${m.color}`}>{m.icon}</div>
                    <p className="text-2xl font-black mb-0.5">{m.value}</p>
                    <p className="text-xs text-muted-foreground">{m.label}</p>
                    <p className={`text-xs mt-1 font-medium ${m.color}`}>{m.sub}</p>
                  </div>
                ))}
              </div>

              {/* Charts */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <div className="bg-white rounded-2xl p-5 border border-border">
                  <p className="font-bold mb-4">روند فروش (۶ ماه)</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <AreaChart key="revenue-chart" data={REVENUE_DATA} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <defs>
                        <linearGradient id="smokey-rev-grad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--color-accent)" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid key="rev-grid" strokeDasharray="3 3" stroke="var(--color-border)" />
                      <XAxis key="rev-x" dataKey="month" tick={{ fontSize: 11, fontFamily: "var(--font-sans)" }} />
                      <YAxis key="rev-y" tick={{ fontSize: 11, fontFamily: "var(--font-sans)" }} tickFormatter={(v: number) => (v / 1_000_000).toLocaleString("fa-IR") + " م"} />
                      <Tooltip formatter={(v: number) => [formatPrice(v), "فروش"]} labelStyle={{ fontFamily: "var(--font-sans)" }} contentStyle={{ fontFamily: "var(--font-sans)", borderRadius: "12px" }} />
                      <Area key="rev-area" type="monotone" dataKey="revenue" stroke="var(--color-accent)" strokeWidth={2} fill="url(#smokey-rev-grad)" isAnimationActive={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="bg-white rounded-2xl p-5 border border-border">
                  <p className="font-bold mb-4">تعداد سفارش‌ها</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart key="orders-chart" data={REVENUE_DATA} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                      <CartesianGrid key="ord-grid" strokeDasharray="3 3" stroke="var(--color-border)" />
                      <XAxis key="ord-x" dataKey="month" tick={{ fontSize: 11, fontFamily: "var(--font-sans)" }} />
                      <YAxis key="ord-y" tick={{ fontSize: 11, fontFamily: "var(--font-sans)" }} />
                      <Tooltip labelStyle={{ fontFamily: "var(--font-sans)" }} contentStyle={{ fontFamily: "var(--font-sans)", borderRadius: "12px" }} />
                      <Bar key="ord-bar" dataKey="orders" fill="var(--color-accent)" radius={[6, 6, 0, 0]} isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Alerts */}
              <div className="bg-white rounded-2xl p-5 border border-border">
                <p className="font-bold mb-4">نیازمند توجه</p>
                <div className="space-y-3">
                  {alerts.map((a, i) => (
                    <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                      <button className="text-sm text-accent-strong hover:underline">مشاهده</button>
                      <div className={`flex items-center gap-2 text-sm font-medium ${a.color}`}>
                        {a.icon} {a.text}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {adminTab === "orders" && (
            // key: remount per order so the local status resets to the order's own
            detailOrder ? <AdminOrderDetail key={detailOrder.id} order={detailOrder} onDone={() => setAdminTab("orders")} /> : (
            <div>
              <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-black">سفارش‌ها</h1>
                <div className="flex gap-2">
                  <label htmlFor="admin-status" className="sr-only">فیلتر وضعیت سفارش</label>
                  <select id="admin-status" className="px-4 py-2.5 rounded-xl border border-border bg-white text-sm transition-colors focus-visible:border-accent-strong">
                    <option>همه وضعیت‌ها</option>
                    {Object.entries(ORDER_STATUS).map(([k, v]) => <option key={k}>{v.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="bg-white rounded-2xl border border-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-secondary/50">
                      <tr>
                        {["شناسه", "مشتری", "تاریخ", "مبلغ", "پرداخت", "وضعیت", "روش پرداخت", "عملیات"].map(h => (
                          <th key={h} className="text-start px-4 py-3 font-semibold text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ORDERS.map(o => (
                        <tr key={o.id} className="border-t border-border hover:bg-secondary/20 transition-colors">
                          <td className="px-4 py-3.5 text-xs nums">#{faDigits(o.id)}</td>
                          <td className="px-4 py-3.5 font-medium">{o.customer}</td>
                          <td className="px-4 py-3.5 text-muted-foreground text-xs">{o.date}</td>
                          <td className="px-4 py-3.5 font-semibold nums">{fa(orderTotals(o).total)}</td>
                          <td className="px-4 py-3.5">
                            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${PAYMENT_STATUS[o.payment].badge}`}>{PAYMENT_STATUS[o.payment].label}</span>
                          </td>
                          <td className="px-4 py-3.5">
                            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${ORDER_STATUS[o.status].badge}`}>{ORDER_STATUS[o.status].label}</span>
                          </td>
                          <td className="px-4 py-3.5 text-xs text-muted-foreground">{o.method === "cod" ? "پرداخت در محل" : "زرین‌پال"}</td>
                          <td className="px-4 py-3.5">
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => onNavigate("admin-panel", "orders", o.id)}
                                aria-label={`مشاهده سفارش ${faDigits(o.id)}`}
                                className="w-10 h-10 rounded-lg hover:bg-secondary flex items-center justify-center transition-colors"
                              >
                                <Eye size={14} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            )
          )}

          {adminTab === "products" && (
            detailId ? (
              // key: remount per product so the form state and errors reset
              <AdminProductForm
                key={detailId}
                productId={detailId === "new" ? undefined : Number(detailId)}
                onDone={() => setAdminTab("products")}
              />
            ) : (
            <div>
              <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-black">محصولات</h1>
                <button
                  onClick={() => onNavigate("admin-panel", "products", "new")}
                  className="flex items-center gap-2 px-4 py-2.5 bg-accent-strong text-white font-medium rounded-xl text-sm hover:bg-accent-hover transition-colors"
                >
                  <Plus size={14} /> افزودن محصول
                </button>
              </div>
              <div className="bg-white rounded-2xl border border-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-secondary/50">
                      <tr>
                        {["تصویر", "نام محصول", "برند", "دسته", "قیمت", "موجودی", "امتیاز", "عملیات"].map(h => (
                          <th key={h} className="text-start px-4 py-3 font-semibold text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {PRODUCTS.map((p, i) => (
                        <tr key={i} className="border-t border-border hover:bg-secondary/20 transition-colors">
                          <td className="px-4 py-3">
                            <img src={p.image} alt="" className="w-10 h-10 rounded-lg object-cover bg-muted" />
                          </td>
                          <td className="px-4 py-3 font-medium max-w-xs">
                            <p className="line-clamp-2">{p.name}</p>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground text-xs">{p.brand}</td>
                          <td className="px-4 py-3 text-xs">{p.category}</td>
                          <td className="px-4 py-3 font-semibold text-xs">{fa(p.price)}</td>
                          <td className="px-4 py-3">
                            {p.stock === 0 ? (
                              <span className="text-xs px-2.5 py-1 rounded-full bg-destructive-soft text-destructive font-medium">ناموجود</span>
                            ) : p.stock <= 5 ? (
                              <span className="text-xs px-2.5 py-1 rounded-full bg-warning-soft text-warning font-medium nums">رو به اتمام ({fa(p.stock)})</span>
                            ) : (
                              <span className="text-xs px-2.5 py-1 rounded-full bg-success-soft text-success-strong font-medium nums">موجود ({fa(p.stock)})</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              <Star size={10} className="fill-accent text-accent" />
                              <span className="text-xs nums">{fa(p.rating)}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              <button onClick={() => onNavigate("product", p.id)} aria-label={`مشاهده ${p.name} در فروشگاه`} className="w-10 h-10 rounded-lg hover:bg-secondary flex items-center justify-center transition-colors"><Eye size={14} /></button>
                              <button onClick={() => onNavigate("admin-panel", "products", p.id)} aria-label={`ویرایش ${p.name}`} className="w-10 h-10 rounded-lg hover:bg-secondary flex items-center justify-center transition-colors"><Edit size={14} /></button>
                              <button aria-label={`غیرفعال کردن ${p.name}`} className="w-10 h-10 rounded-lg hover:bg-destructive-soft flex items-center justify-center transition-colors text-destructive"><Trash2 size={14} /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            )
          )}

          {adminTab === "customers" && (
            <div>
              <h1 className="text-2xl font-black mb-6">مشتریان</h1>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                {[{ label: "کل مشتریان", value: (1245).toLocaleString("fa-IR") }, { label: "مشتریان فعال", value: (892).toLocaleString("fa-IR") }, { label: "مشتری جدید این ماه", value: (64).toLocaleString("fa-IR") }].map((m, i) => (
                  <div key={i} className="bg-white rounded-2xl p-5 border border-border">
                    <p className="text-2xl font-black">{m.value}</p>
                    <p className="text-muted-foreground text-sm">{m.label}</p>
                  </div>
                ))}
              </div>
              <div className="bg-white rounded-2xl border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-secondary/50">
                    <tr>
                      {["مشتری", "شماره موبایل", "تعداد سفارش", "مجموع خرید", "عضویت", "عملیات"].map(h => (
                        <th key={h} className="text-start px-4 py-3 font-semibold text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { name: "سارا محمدی", phone: "۰۹۱۲۰۰۰۰۰۰۰", orders: 8, total: (4850000).toLocaleString("fa-IR"), joined: "۱۴۰۲/۰۳" },
                      { name: "علی رضایی", phone: "۰۹۱۳۱۱۱۱۱۱۱", orders: 5, total: (2340000).toLocaleString("fa-IR"), joined: "۱۴۰۲/۰۷" },
                      { name: "نیلوفر کریمی", phone: "۰۹۳۵۲۲۲۲۲۲۲", orders: 12, total: (7210000).toLocaleString("fa-IR"), joined: "۱۴۰۱/۱۱" },
                    ].map((c, i) => (
                      <tr key={i} className="border-t border-border hover:bg-secondary/20">
                        <td className="px-4 py-3.5 font-medium">{c.name}</td>
                        <td className="px-4 py-3.5 text-muted-foreground text-xs nums" dir="ltr">{c.phone}</td>
                        <td className="px-4 py-3.5">{fa(c.orders)}</td>
                        <td className="px-4 py-3.5 font-semibold text-xs">{c.total}</td>
                        <td className="px-4 py-3.5 text-xs text-muted-foreground">{c.joined}</td>
                        <td className="px-4 py-3.5"><button aria-label={`مشاهده مشتری ${c.name}`} className="w-10 h-10 rounded-lg hover:bg-secondary flex items-center justify-center"><Eye size={14} /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {adminTab === "settings" && <AdminShippingRates />}

          {(adminTab === "content" || adminTab === "discounts" || adminTab === "reports") && (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-center">
              <div className="w-14 h-14 rounded-2xl bg-secondary flex items-center justify-center text-2xl">
                {adminTab === "content" ? "📝" : adminTab === "discounts" ? "🏷️" : "📊"}
              </div>
              <p className="font-bold">{navItems.find(n => n.id === adminTab)?.label}</p>
              <p className="text-muted-foreground text-sm">این بخش در حال توسعه است.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
const PAGES: Page[] = ["home", "shop", "product", "about", "checkout", "account", "admin-panel", "login", "result"];

/**
 * Hash routing so every screen is deep-linkable and demoable:
 *   #/shop  #/product/3  #/login  #/checkout  #/result/failed  #/admin-panel
 * The port replaces this with App Router paths — it exists so the design
 * prototype has no hidden screens (and so the storefront needs no floating
 * "پنل مدیریت" button, which must never ship).
 */
function readHash(): { page: Page; args: string[] } {
  const [p, ...args] = window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  return { page: (PAGES as string[]).includes(p) ? (p as Page) : "home", args };
}

interface PlacedOrder {
  no: string;
  items: CartItem[];
  total: number;
  fee: number;
  method: PaymentMethod;
}

export default function App() {
  const [route, setRoute] = useState(readHash);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [order, setOrder] = useState<PlacedOrder | null>(null);

  useEffect(() => {
    const onHash = () => setRoute(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  function navigate(p: Page, ...args: (number | string)[]) {
    const next = `#/${[p, ...args].join("/")}`;
    if (window.location.hash === next) setRoute(readHash());
    else window.location.hash = next;
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }

  function addToCart(item: CartItem) {
    setCartItems(prev => {
      const exists = prev.find(i => i.id === item.id);
      if (exists) return prev.map(i => i.id === item.id ? { ...i, qty: Math.min(i.stock, i.qty + item.qty) } : i);
      return [...prev, item];
    });
    setCartOpen(true);
  }

  function updateCart(id: number, qty: number) {
    if (qty <= 0) setCartItems(prev => prev.filter(i => i.id !== id));
    else setCartItems(prev => prev.map(i => i.id === id ? { ...i, qty } : i));
  }

  /**
   * The cart is cleared on successful order *creation*, before any gateway
   * redirect ([[Design - Checkout Flow Frontend]]) — so a failed payment leaves
   * an order to retry, never a second checkout of the same cart.
   */
  function placeOrder({ method, fee }: { method: PaymentMethod; province: string; fee: number }) {
    setOrder({
      no: faDigits(10046),
      items: cartItems,
      total: cartItems.reduce((s, i) => s + i.price * i.qty, 0),
      fee,
      method,
    });
    setCartItems([]);
    navigate("result", "success");
  }

  const { page, args } = route;
  const arg = args[0];
  const cartCount = cartItems.reduce((s, i) => s + i.qty, 0);

  // Admin is a separate full-screen layout, reachable only at #/admin-panel —
  // in the app it is a role-gated /admin route ([[Story - Admin Product Management]]).
  if (page === "admin-panel") {
    return <AdminPage args={args} onNavigate={navigate} />;
  }

  // Checkout is auth-gated: sessionless users get OTP login and come back.
  const needsLogin = page === "checkout" && !signedIn;

  return (
    <div dir="rtl" lang="fa" className="bg-background text-foreground min-h-screen">
      <Navbar cartCount={cartCount} onNavigate={navigate} onCartOpen={() => setCartOpen(true)} currentPage={page} />

      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} items={cartItems} onUpdate={updateCart} onNavigate={navigate} />

      {page === "home" && <HomePage onAddToCart={addToCart} onNavigate={navigate} />}
      {page === "shop" && <ShopPage onAddToCart={addToCart} onNavigate={navigate} />}
      {page === "product" && <ProductPage productId={Number(arg) || 1} onAddToCart={addToCart} onNavigate={navigate} />}
      {page === "about" && <AboutPage onNavigate={navigate} />}
      {page === "login" && (
        <LoginPage onNavigate={navigate} onLogin={() => { setSignedIn(true); navigate("account"); }} />
      )}
      {needsLogin && (
        <LoginPage
          onNavigate={navigate}
          onLogin={() => { setSignedIn(true); navigate("checkout"); }}
          nextLabel="تکمیل خرید"
        />
      )}
      {page === "checkout" && !needsLogin && (
        <CheckoutPage cartItems={cartItems} onNavigate={navigate} onPlaceOrder={placeOrder} />
      )}
      {page === "result" && (
        <PaymentResultPage
          status={(["success", "failed", "pending"] as ResultStatus[]).includes(arg as ResultStatus) ? (arg as ResultStatus) : "success"}
          order={order}
          onNavigate={navigate}
        />
      )}
      {page === "account" && <AccountPage args={args} onNavigate={navigate} />}

      {page !== "checkout" && <Footer onNavigate={navigate} />}
    </div>
  );
}
