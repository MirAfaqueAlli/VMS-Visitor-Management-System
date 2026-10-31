// frontend/src/components/icons.jsx
// The app's one icon module (DESIGN_RULES §15): Phosphor icons, re-exported under
// app names. Pages import from here — never from the icon library directly.
//
//   <Plus size={14} />              regular weight (control glyphs)
//   <Users size={18} duo />         two-tone (nav, section heads, empty states, KPI chips)
//   <X strokeWidth={2.5} />         lucide-style prop still works: ≥ 2.2 → bold
//
// The 20%-opacity layer of a duo icon is recoloured by --duo-fill (.duo in index.css).
import {
  Pulse, WarningCircle, Warning, ArrowLeft as PArrowLeft, ArrowRight as PArrowRight, ArrowsDownUp,
  ArrowUpRight as PArrowUpRight, Prohibit, ChartBar, Bell as PBell, BellSlash, Briefcase as PBriefcase,
  Building as PBuilding, BuildingOffice, Calendar as PCalendar, CalendarDots, Camera as PCamera,
  Check as PCheck, CheckCircle as PCheckCircle, CheckSquare as PCheckSquare, CaretDown, CaretLeft,
  CaretRight, CaretDoubleLeft, CaretDoubleRight, ClipboardText, ListChecks, Clock as PClock,
  ArrowElbowDownRight, CreditCard as PCreditCard, DownloadSimple, PencilSimple, Eye as PEye, EyeSlash,
  FileXls, FileText as PFileText, Funnel, Globe as PGlobe, Hash as PHash, Question, Key, Keyboard as PKeyboard,
  Stack, SquaresFour, CircleNotch, Lock as PLock, SignOut, Envelope, MapPin as PMapPin, List, Moon as PMoon,
  Phone as PPhone, Plus as PPlus, Power as PPower, Printer as PPrinter, QrCode as PQrCode, ArrowsClockwise,
  ArrowCounterClockwise, Scan as PScan, MagnifyingGlass, Gear, Shield as PShield, ShieldWarning,
  ShieldCheck as PShieldCheck, ShieldSlash, DeviceMobile, Sun as PSun, Tag as PTag, Trash, TrendUp,
  TrendDown as PTrendDown, UploadSimple, User as PUser, UserCheck as PUserCheck, UserCircle as PUserCircle,
  UserGear, UserPlus as PUserPlus, UserMinus, Users as PUsers, X as PX, MagnifyingGlassPlus, Lightning,
  SidebarSimple, CaretUp, Info as PInfo, Tray, DotsThree, Paperclip as PPaperclip, ArrowSquareOut,
  Circle as PCircle,
} from '@phosphor-icons/react';

/** Wraps a Phosphor icon so it accepts the props the app already passes (lucide style). */
function wrap(Icon, name) {
  function AppIcon({ size = 24, strokeWidth, weight, duo, className = '', ...rest }) {
    const w = weight ?? (duo ? 'duotone' : strokeWidth >= 2.2 ? 'bold' : 'regular');
    return <Icon size={size} weight={w} className={duo ? `duo ${className}`.trim() : className} {...rest} />;
  }
  AppIcon.displayName = name;
  return AppIcon;
}

/* ── App names (match the names used across the pages) ─────────────────────── */
export const Activity          = wrap(Pulse, 'Activity');
export const AlertCircle       = wrap(WarningCircle, 'AlertCircle');
export const AlertTriangle     = wrap(Warning, 'AlertTriangle');
export const ArrowLeft         = wrap(PArrowLeft, 'ArrowLeft');
export const ArrowRight        = wrap(PArrowRight, 'ArrowRight');
export const ArrowUpDown       = wrap(ArrowsDownUp, 'ArrowUpDown');
export const ArrowUpRight      = wrap(PArrowUpRight, 'ArrowUpRight');
export const Ban               = wrap(Prohibit, 'Ban');
export const BarChart2         = wrap(ChartBar, 'BarChart2');
export const BarChart3         = wrap(ChartBar, 'BarChart3');
export const Bell              = wrap(PBell, 'Bell');
export const BellOff           = wrap(BellSlash, 'BellOff');
export const Briefcase         = wrap(PBriefcase, 'Briefcase');
export const Building          = wrap(PBuilding, 'Building');
export const Building2         = wrap(BuildingOffice, 'Building2');
export const Calendar          = wrap(PCalendar, 'Calendar');
export const CalendarDays      = wrap(CalendarDots, 'CalendarDays');
export const Camera            = wrap(PCamera, 'Camera');
export const Check             = wrap(PCheck, 'Check');
export const CheckCircle       = wrap(PCheckCircle, 'CheckCircle');
export const CheckCircle2      = wrap(PCheckCircle, 'CheckCircle2');
export const CheckSquare       = wrap(PCheckSquare, 'CheckSquare');
export const ChevronDown       = wrap(CaretDown, 'ChevronDown');
export const ChevronUp         = wrap(CaretUp, 'ChevronUp');
export const ChevronLeft       = wrap(CaretLeft, 'ChevronLeft');
export const ChevronRight      = wrap(CaretRight, 'ChevronRight');
export const ChevronsLeft      = wrap(CaretDoubleLeft, 'ChevronsLeft');
export const ChevronsRight     = wrap(CaretDoubleRight, 'ChevronsRight');
export const Circle            = wrap(PCircle, 'Circle');
export const ClipboardCheck    = wrap(ClipboardText, 'ClipboardCheck');
export const ClipboardList     = wrap(ListChecks, 'ClipboardList');
export const Clock             = wrap(PClock, 'Clock');
export const CornerDownRight   = wrap(ArrowElbowDownRight, 'CornerDownRight');
export const CreditCard        = wrap(PCreditCard, 'CreditCard');
export const Download          = wrap(DownloadSimple, 'Download');
export const Edit2             = wrap(PencilSimple, 'Edit2');
export const ExternalLink      = wrap(ArrowSquareOut, 'ExternalLink');
export const Eye               = wrap(PEye, 'Eye');
export const EyeOff            = wrap(EyeSlash, 'EyeOff');
export const FileSpreadsheet   = wrap(FileXls, 'FileSpreadsheet');
export const FileText          = wrap(PFileText, 'FileText');
export const Filter            = wrap(Funnel, 'Filter');
export const Globe             = wrap(PGlobe, 'Globe');
export const Hash              = wrap(PHash, 'Hash');
export const HelpCircle        = wrap(Question, 'HelpCircle');
export const Inbox             = wrap(Tray, 'Inbox');
export const Info              = wrap(PInfo, 'Info');
export const KeyRound          = wrap(Key, 'KeyRound');
export const Keyboard          = wrap(PKeyboard, 'Keyboard');
export const Layers            = wrap(Stack, 'Layers');
export const LayoutDashboard   = wrap(SquaresFour, 'LayoutDashboard');
export const Loader2           = wrap(CircleNotch, 'Loader2');
export const Lock              = wrap(PLock, 'Lock');
export const LogOut            = wrap(SignOut, 'LogOut');
export const Mail              = wrap(Envelope, 'Mail');
export const MapPin            = wrap(PMapPin, 'MapPin');
export const Menu              = wrap(List, 'Menu');
export const Moon              = wrap(PMoon, 'Moon');
export const MoreHorizontal    = wrap(DotsThree, 'MoreHorizontal');
export const Paperclip         = wrap(PPaperclip, 'Paperclip');
export const Phone             = wrap(PPhone, 'Phone');
export const Plus              = wrap(PPlus, 'Plus');
export const Power             = wrap(PPower, 'Power');
export const Printer           = wrap(PPrinter, 'Printer');
export const QrCode            = wrap(PQrCode, 'QrCode');
export const RefreshCw         = wrap(ArrowsClockwise, 'RefreshCw');
export const RotateCcw         = wrap(ArrowCounterClockwise, 'RotateCcw');
export const Scan              = wrap(PScan, 'Scan');
export const Search            = wrap(MagnifyingGlass, 'Search');
export const Settings          = wrap(Gear, 'Settings');
export const Shield            = wrap(PShield, 'Shield');
export const ShieldAlert       = wrap(ShieldWarning, 'ShieldAlert');
export const ShieldCheck       = wrap(PShieldCheck, 'ShieldCheck');
export const ShieldOff         = wrap(ShieldSlash, 'ShieldOff');
export const SidebarToggle     = wrap(SidebarSimple, 'SidebarToggle');
export const Smartphone        = wrap(DeviceMobile, 'Smartphone');
export const Sun               = wrap(PSun, 'Sun');
export const Tag               = wrap(PTag, 'Tag');
export const Trash2            = wrap(Trash, 'Trash2');
export const TrendingUp        = wrap(TrendUp, 'TrendingUp');
export const TrendingDown      = wrap(PTrendDown, 'TrendingDown');
export const Upload            = wrap(UploadSimple, 'Upload');
export const User              = wrap(PUser, 'User');
export const UserCheck         = wrap(PUserCheck, 'UserCheck');
export const UserCircle        = wrap(PUserCircle, 'UserCircle');
export const UserCog           = wrap(UserGear, 'UserCog');
export const UserPlus          = wrap(PUserPlus, 'UserPlus');
export const UserRound         = wrap(PUser, 'UserRound');
export const UserX             = wrap(UserMinus, 'UserX');
export const Users             = wrap(PUsers, 'Users');
export const X                 = wrap(PX, 'X');
export const ZoomIn            = wrap(MagnifyingGlassPlus, 'ZoomIn');

/** The one shared navigation icon (DESIGN_RULES §5 — the label carries the meaning). */
export const NavIcon           = wrap(Lightning, 'NavIcon');
