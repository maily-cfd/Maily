"use client";

import { useState, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  User,
  Mail,
  MapPin,
  Link as LinkIcon,
  Save,
  Loader2,
  ArrowLeft,
  Camera,
  Shield,
  Bell,
  Palette,
  Globe,
  CreditCard,
  FileText,
  Activity,
  Calendar,
  Clock,
  Plug,
  DoorOpen,
  MoreHorizontal,
  LogOut,
  Briefcase,
  Check,
  Upload,
  X as CloseIcon,
  Crown,
  Sparkles
} from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { NotificationIcon } from "@/components/ui/notification-icon";
import AvatarUpload from "../../../components/ui/avatar-upload";
import { IntegrationsModal } from "../../../components/ui/integrations-modal";
import { WebsiteLink } from "../../../components/ui/website-link";

interface UserProfile {
  user_id: string;
  name: string | null;
  email: string;
  avatar_url: string | null;
  banner_url: string | null;
  username: string | null;
  bio: string | null;
  location: string | null;
  website: string | null;
  status: 'online' | 'away' | 'offline';
  last_synced_at: string | null;
  email_accounts_connected: number;
  emails_processed: number;
  plan: string;
  storage_used: string;
  last_email_activity: string | null;
  work_status: string | null;
  preferences: {
    theme: 'light' | 'dark' | 'system';
    language: string;
    timezone: string;
    date_format: string;
    time_format: string;
    email_notifications: boolean;
    push_notifications: boolean;
    marketing_emails: boolean;
    auto_save: boolean;
    compact_mode: boolean;
  };
  privacy_settings: {
    profile_visibility: 'public' | 'private' | 'contacts';
    show_online_status: boolean;
    allow_direct_messages: boolean;
    data_collection: boolean;
    analytics: boolean;
  };
  notification_settings: {
    email_digest: 'never' | 'daily' | 'weekly' | 'monthly';
    desktop_notifications: boolean;
    sound_enabled: boolean;
    mention_notifications: boolean;
    reply_notifications: boolean;
  };
  created_at: string;
  updated_at: string;
  earned_badges?: string[];
}

export default function ProfileSettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState<'profile' | 'account' | 'preferences' | 'privacy' | 'notifications' | 'integrations'>('profile');
  const [isIntegrationsOpen, setIsIntegrationsOpen] = useState(false);
  const [isMoreOptionsOpen, setIsMoreOptionsOpen] = useState<boolean>(false);

  // Redesign additions
  const [planType, setPlanType] = useState<string>('free');
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  
  // Partner Apply states
  const [partnerModalType, setPartnerModalType] = useState<'creator' | 'affiliate' | null>(null);
  const [partnerEmail, setPartnerEmail] = useState('');
  const [partnerSubmitted, setPartnerSubmitted] = useState(false);
  const [partnerSubmitting, setPartnerSubmitting] = useState(false);

  const handleLogout = async () => {
    setIsMoreOptionsOpen(false);
    await signOut({ redirect: false });
    router.push("/");
  };

  const [formData, setFormData] = useState({
    name: '',
    username: '',
    bio: '',
    location: '',
    website: '',
    work_status: '',
    preferences: {} as UserProfile['preferences'],
    privacy_settings: {} as UserProfile['privacy_settings'],
    notification_settings: {} as UserProfile['notification_settings']
  });

  // Fetch subscription status directly for the badge verification
  useEffect(() => {
    const fetchSubStatus = async () => {
      try {
        const res = await fetch('/api/subscription/status');
        if (res.ok) {
          const data = await res.json();
          setPlanType(data.subscription?.planType || 'free');
        }
      } catch (e) {
        console.error("Error fetching subscription status:", e);
      }
    };
    if (status === 'authenticated') {
      fetchSubStatus();
    }
  }, [status]);

  // Fetch user profile
  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const response = await fetch('/api/profile');
        if (response.ok) {
          const data = await response.json();
          console.log('Profile data received:', data);
          setProfile(data);
          setFormData({
            name: data.name || '',
            username: data.username || '',
            bio: data.bio || '',
            location: data.location || '',
            website: data.website || '',
            work_status: data.work_status || '',
            preferences: data.preferences || formData.preferences,
            privacy_settings: data.privacy_settings || formData.privacy_settings,
            notification_settings: data.notification_settings || formData.notification_settings
          });
        }
      } catch (error) {
        console.error('Failed to fetch profile:', error);
      } finally {
        setLoading(false);
      }
    };

    if (status === 'authenticated') {
      fetchProfile();
    }
  }, [status]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: formData.name,
          username: formData.username,
          bio: formData.bio,
          location: formData.location,
          website: formData.website,
          work_status: formData.work_status,
          preferences: formData.preferences,
          privacy_settings: formData.privacy_settings,
          notification_settings: formData.notification_settings
        }),
      });

      if (response.ok) {
        const updatedProfile = await response.json();
        setProfile(updatedProfile);
        setIsEditingProfile(false);
        toast.success('Profile updated');
      } else {
        const err = await response.json();
        toast.error(err.error || 'Failed to update profile');
      }
    } catch (error) {
      console.error('Save error:', error);
      toast.error('Failed to update profile', { description: 'Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarChange = (avatarUrl: string) => {
    setProfile(prev => prev ? { ...prev, avatar_url: avatarUrl } : null);
    setFormData(prev => ({ ...prev, avatar_url: avatarUrl } as any));
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'avatar' | 'banner') => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File is too large', { description: 'Maximum size is 5MB.' });
      return;
    }

    if (type === 'avatar') setUploadingAvatar(true);
    else setUploadingBanner(true);

    try {
      const form = new FormData();
      form.append(type, file);

      const response = await fetch('/api/profile/avatar', {
        method: 'POST',
        body: form
      });

      if (response.ok) {
        const resData = await response.json();
        setProfile(prev => prev ? { ...prev, [type === 'avatar' ? 'avatar_url' : 'banner_url']: resData.url } : null);
        if (type === 'avatar') {
          setFormData(prev => ({ ...prev, avatar_url: resData.url } as any));
        }
        toast.success(`${type === 'avatar' ? 'Avatar' : 'Banner'} uploaded`);
      } else {
        const err = await response.json();
        toast.error(err.error || `Failed to upload ${type}`);
      }
    } catch (err) {
      console.error(err);
      toast.error(`Failed to upload ${type}`, { description: 'Please try again.' });
    } finally {
      if (type === 'avatar') setUploadingAvatar(false);
      else setUploadingBanner(false);
    }
  };

  const handlePartnerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!partnerEmail.trim() || !partnerModalType) return;
    setPartnerSubmitting(true);
    try {
      const response = await fetch('/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: partnerEmail, type: partnerModalType }),
      });
      if (response.ok) {
        setPartnerSubmitted(true);
      } else {
        const err = await response.json();
        toast.error(err.error || 'Failed to submit application', { description: 'Please try again.' });
      }
    } catch (err) {
      console.error('Error submitting application:', err);
      toast.error('Failed to submit application', { description: 'Please try again.' });
    } finally {
      setPartnerSubmitting(false);
    }
  };

  const openPartnerModal = (type: 'creator' | 'affiliate') => {
    setPartnerEmail(profile?.email || session?.user?.email || '');
    setPartnerModalType(type);
    setPartnerSubmitted(false);
    setPartnerSubmitting(false);
  };

  const handleSyncProfile = async () => {
    setSyncing(true);
    try {
      const response = await fetch('/api/profile/sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        setProfile(data.profile);
        toast.success('Profile synced');
      } else {
        toast.error('Failed to sync profile');
      }
    } catch (error) {
      console.error('Sync error:', error);
      toast.error('Failed to sync profile', { description: 'Please try again.' });
    } finally {
      setSyncing(false);
    }
  };

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen bg-[#000] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-white" />
      </div>
    );
  }

  if (status === 'unauthenticated') {
    router.push('/');
    return null;
  }

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-[#000] text-white satoshi-profile-settings" style={{ fontFamily: "'Satoshi', ui-sans-serif, system-ui, sans-serif" }}>
        {/* Universal Sidebar - Fixed Position Full Height */}
        <div className="fixed left-0 top-0 h-screen w-20 bg-[#0a0a0a]/50 backdrop-blur-sm border-r border-[#525252] flex flex-col z-20">
          {/* Sidebar Icons */}
          <div className="flex flex-col items-end py-20 gap-6 pr-4">
            {/* Email Icon */}
            <Tooltip delayDuration={100}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => {
                    window.location.href = '/home-feed';
                    document.title = 'Home | Maily';
                  }}
                  className="p-2 hover:bg-[#1a1a1a] rounded-full transition-all duration-300 hover:scale-105"
                  aria-label="Feed"
                >
                  <Mail className="w-6 h-6 text-[#fcfcfc]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>Feed</p>
              </TooltipContent>
            </Tooltip>
            
            {/* Notifications Icon */}
            <Tooltip delayDuration={100}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => {
                    window.location.href = '/notifications';
                    document.title = 'Notifications | Maily';
                  }}
                  className="p-2 hover:bg-[#1a1a1a] rounded-full transition-all duration-300 hover:scale-105"
                  aria-label="Notifications"
                >
                  <NotificationIcon iconClassName="w-6 h-6 text-[#fcfcfc]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>Notifications</p>
              </TooltipContent>
            </Tooltip>
            

            
            {/* Boult Symbol */}
            <Tooltip delayDuration={100}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => window.location.href = '/dashboard/agent-talk'}
                  className="p-3 transition-all duration-300 hover:scale-105 flex items-center justify-center w-12 h-12"
                  aria-label="Agent Talk"
                >
                  <span className="text-[#fcfcfc] oleo-script-regular text-2xl ml-2">A</span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>Boult</p>
              </TooltipContent>
            </Tooltip>
            
            {/* Profile Icon */}
            <Tooltip delayDuration={100}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => window.location.href = '/dashboard/profile-bubble'}
                  className="p-2 hover:bg-[#1a1a1a] rounded-full transition-all duration-300 hover:scale-105"
                  aria-label="Profile"
                >
                  <User className="w-6 h-6 text-[#fcfcfc]" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>Profile</p>
              </TooltipContent>
            </Tooltip>
            
            {/* More Options Icon */}
            <div className="relative">
              <Tooltip delayDuration={100}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setIsMoreOptionsOpen(!isMoreOptionsOpen)}
                    className="p-2 hover:bg-[#1a1a1a] rounded-full transition-all duration-300 hover:scale-105"
                    aria-label="More Options"
                  >
                    <MoreHorizontal className="w-6 h-6 text-[#fcfcfc]" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>More Options</p>
                </TooltipContent>
              </Tooltip>
              
              {/* Dialog Box */}
              {isMoreOptionsOpen && (
                <div className="absolute left-20 top-0 z-50 bg-[#000] border border-[#2a2a2a] rounded-lg shadow-xl p-2 min-w-48 animate-fadeIn">
                  <button
                    onClick={() => {
                      window.location.href = '/settings';
                      setIsMoreOptionsOpen(false);
                    }}
                    className="w-full text-left px-4 py-3 text-[#fcfcfc] hover:bg-[#2a2a2a] rounded-md transition-all duration-200"
                  >
                    <div className="font-medium">Settings & Privacy</div>
                  </button>
                  <button
                    onClick={() => {
                      window.location.href = '/pricing';
                      setIsMoreOptionsOpen(false);
                    }}
                    className="w-full text-left px-4 py-3 text-[#fcfcfc] hover:bg-[#2a2a2a] rounded-md transition-all duration-200"
                  >
                    <div className="font-medium">Upgrade Plan</div>
                  </button>
                  <div className="border-t border-[#2a2a2a] my-1"></div>
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-4 py-3 text-red-500 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all duration-300 group relative overflow-hidden"
                  >
                    <LogOut className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-0.5" />
                    <span className="font-medium">Log Out</span>
                    <div className="absolute inset-0 bg-gradient-to-r from-red-500/0 via-red-500/20 to-red-500/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Main Content with left margin for sidebar */}
        <div className="ml-20">
          {/* Header */}
          <div className="border-b border-[#333333] bg-[#1A1A1A]">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex items-center justify-between h-16">
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => router.back()}
                    className="text-gray-400 hover:text-white transition-colors"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <h1 className="text-xl font-semibold">Profile Settings</h1>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleSyncProfile}
                    disabled={syncing}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white rounded-md transition-colors"
                  >
                    {syncing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Globe className="w-4 h-4" />
                    )}
                    {syncing ? 'Syncing...' : 'Sync Profile'}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-md transition-colors"
                  >
                    {saving ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </div>
          </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Sidebar Tabs */}
          <div className="lg:col-span-1">
            <div className="bg-[#1A1A1A] rounded-lg p-4">
              <nav className="space-y-2">
                {[
                  { id: 'profile', label: 'Profile', icon: User },
                  { id: 'account', label: 'Account', icon: CreditCard },
                  { id: 'preferences', label: 'Preferences', icon: Palette },
                  { id: 'privacy', label: 'Privacy', icon: Shield },
                  { id: 'notifications', label: 'Notifications', icon: Bell },
                  { id: 'integrations', label: 'Integrations', icon: Plug }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left rounded-md transition-colors ${
                      activeTab === tab.id
                        ? 'bg-[#2e2d2d] text-white'
                        : 'text-gray-300 hover:bg-[#2A2A2A]'
                    }`}
                  >
                    <tab.icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                ))}
              </nav>
            </div>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-2">
            <div className="bg-[#1A1A1A] rounded-lg p-6">
              {/* Profile Tab */}
              {activeTab === 'profile' && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-lg font-medium mb-4">Profile Information</h2>

                    {/* Avatar Section */}
                    <div className="mb-6">
                      <label className="block text-sm font-medium text-gray-300 mb-3">
                        Profile Picture
                      </label>
                      <AvatarUpload
                        currentAvatar={profile?.avatar_url}
                        onAvatarChange={handleAvatarChange}
                        size="lg"
                      />
                    </div>

                    {/* Basic Info */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          Display Name
                        </label>
                        <div className="relative">
                          <User className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <input
                            type="text"
                            value={formData.name}
                            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                            className="w-full pl-10 pr-3 py-2 bg-[#2A2A2A] border border-[#444444] rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Enter your display name"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          Email Address
                        </label>
                        <div className="relative">
                          <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <input
                            type="email"
                            value={profile?.email || ''}
                            disabled
                            className="w-full pl-10 pr-3 py-2 bg-[#2A2A2A] border border-[#444444] rounded-md text-gray-400 cursor-not-allowed"
                          />
                        </div>
                        <p className="text-xs text-gray-500 mt-1">Email cannot be changed</p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          Location
                        </label>
                        <div className="relative">
                          <MapPin className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <input
                            type="text"
                            value={formData.location}
                            onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                            className="w-full pl-10 pr-3 py-2 bg-[#2A2A2A] border border-[#444444] rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="City, Country"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          Website
                        </label>
                        <div className="relative">
                          <LinkIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                          <input
                            type="url"
                            value={formData.website}
                            onChange={(e) => setFormData(prev => ({ ...prev, website: e.target.value }))}
                            className="w-full pl-10 pr-3 py-2 bg-[#2A2A2A] border border-[#444444] rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="https://yourwebsite.com"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Bio */}
                    <div className="mt-4">
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Bio
                      </label>
                      <textarea
                        value={formData.bio}
                        onChange={(e) => setFormData(prev => ({ ...prev, bio: e.target.value }))}
                        rows={3}
                        className="w-full px-3 py-2 bg-[#2A2A2A] border border-[#444444] rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Tell us about yourself..."
                      />
                    </div>

                    {/* Last Synced */}
                    <div className="mt-4">
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Last Synced with Google
                      </label>
                      <div className="text-gray-400">
                        {profile?.last_synced_at
                          ? new Date(profile.last_synced_at).toLocaleString()
                          : 'Never synced'}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Account Tab (Redesigned X-Style Profile Card) */}
              {activeTab === 'account' && (
                <div className="space-y-6">
                  <div className="bg-[#151515] rounded-[24px] border border-white/[0.04] overflow-hidden shadow-2xl relative">
                    
                    {/* Private Account View Indicator */}
                    <div className="absolute top-4 left-4 z-20 bg-black/60 backdrop-blur-md px-3 py-1 rounded-full border border-white/[0.08] text-[9px] font-bold uppercase tracking-wider text-neutral-400 flex items-center gap-1.5 pointer-events-none select-none animate-fadeIn">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
                      🔒 Private Account View
                    </div>

                    {/* X-Style Banner Cover */}
                    <div className="relative w-full aspect-[3.2/1] bg-gradient-to-br from-neutral-900 via-[#1b1b1b] to-neutral-950 border-b border-white/[0.04] overflow-hidden group">
                      {profile?.banner_url ? (
                        <img 
                          src={profile.banner_url} 
                          alt="Cover Banner" 
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center opacity-30">
                          <Sparkles className="w-12 h-12 text-neutral-500 animate-pulse" />
                        </div>
                      )}
                      
                      {/* Banner Edit Overlay */}
                      {isEditingProfile && (
                        <label className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex flex-col items-center justify-center cursor-pointer z-10">
                          {uploadingBanner ? (
                            <Loader2 className="w-8 h-8 text-white animate-spin" />
                          ) : (
                            <>
                              <Camera className="w-8 h-8 text-white mb-2" />
                              <span className="text-white text-xs font-bold uppercase tracking-wider">Change Cover Banner</span>
                            </>
                          )}
                          <input 
                            type="file" 
                            accept="image/*" 
                            onChange={(e) => handleImageUpload(e, 'banner')} 
                            className="hidden" 
                          />
                        </label>
                      )}
                    </div>

                    {/* Profile Header Row (Avatar, Edit Buttons) */}
                    <div className="px-6 flex justify-between items-start relative h-12 sm:h-16">
                      
                      {/* Overlapping Avatar */}
                      <div className="absolute -top-12 sm:-top-16 left-6 w-20 h-20 sm:w-28 sm:h-28 rounded-full border-[4px] border-[#151515] bg-[#1a1a1a] shadow-xl overflow-hidden relative group">
                        {profile?.avatar_url ? (
                          <img 
                            src={profile.avatar_url} 
                            alt="Logo" 
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-neutral-600 bg-neutral-900">
                            <User className="w-8 h-8 sm:w-10 sm:h-10" />
                          </div>
                        )}

                        {/* Avatar Edit Overlay */}
                        {isEditingProfile && (
                          <label className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center cursor-pointer z-10">
                            {uploadingAvatar ? (
                              <Loader2 className="w-6 h-6 text-white animate-spin" />
                            ) : (
                              <Camera className="w-6 h-6 text-white" />
                            )}
                            <input 
                              type="file" 
                              accept="image/*" 
                              onChange={(e) => handleImageUpload(e, 'avatar')} 
                              className="hidden" 
                            />
                          </label>
                        )}
                      </div>

                      {/* Right-aligned actions */}
                      <div className="ml-auto mt-4">
                        {!isEditingProfile ? (
                          <button
                            onClick={() => setIsEditingProfile(true)}
                            className="px-5 py-1.5 rounded-full border border-neutral-700 hover:border-neutral-400 hover:bg-white/5 font-extrabold text-xs text-white transition-all duration-200 select-none shadow-md"
                          >
                            Edit Profile
                          </button>
                        ) : (
                          <div className="flex gap-2">
                            <button
                              onClick={() => {
                                setFormData(prev => ({
                                  ...prev,
                                  name: profile?.name || '',
                                  username: profile?.username || '',
                                  bio: profile?.bio || '',
                                  location: profile?.location || '',
                                  website: profile?.website || '',
                                  work_status: profile?.work_status || '',
                                }));
                                setIsEditingProfile(false);
                              }}
                              className="px-4 py-1.5 rounded-full border border-neutral-800 hover:bg-white/5 text-neutral-400 font-extrabold text-xs transition-all duration-200 select-none"
                            >
                              Cancel
                            </button>
                            <button
                              onClick={handleSave}
                              disabled={saving}
                              className="px-5 py-1.5 rounded-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:text-white/40 text-white font-extrabold text-xs flex items-center gap-1.5 transition-all duration-200 select-none shadow-md"
                            >
                              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                              Save Changes
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Profile Information Block */}
                    <div className="px-6 pb-6 pt-2 space-y-4">
                      
                      {/* Name / Handle / Founder Badge */}
                      <div>
                        {!isEditingProfile ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <h2 className="text-2xl font-black text-white tracking-tight leading-none">
                                {profile?.name || 'Maily User'}
                              </h2>
                              
                              {/* Founder Badge logic */}
                              {(planType === 'pro' || planType === 'annual' || planType === 'starter') && (
                                <Tooltip delayDuration={150}>
                                  <TooltipTrigger asChild>
                                    <svg className="w-5 h-5 inline-block select-none filter drop-shadow-[0_0_4px_rgba(245,158,11,0.5)] transition-transform hover:scale-110 cursor-pointer shrink-0" viewBox="0 0 24 24" fill="currentColor">
                                      <path d="M22.5 12.5c0-1.58-.875-2.95-2.148-3.6.154-.435.238-.905.238-1.4 0-2.21-1.71-3.99-3.818-3.99-.48 0-.94.1-1.348.27C14.78 2.518 13.483 1.5 12 1.5c-1.483 0-2.78 1.018-3.422 2.28-.408-.17-.867-.27-1.348-.27-2.108 0-3.818 1.78-3.818 3.99 0 .495.084.965.238 1.4-1.273.65-2.148 2.02-2.148 3.6 0 1.58.875 2.95 2.148 3.6-.154.435-.238.905-.238 1.4 0 2.21 1.71 3.99 3.818 3.99.48 0 .94-.1 1.348-.27.643 1.262 1.939 2.28 3.422 2.28 1.483 0 2.78-1.018 3.422-2.28.408.17.867.27 1.348.27 2.108 0 3.818-1.78 3.818-3.99 0-.495-.084-.965-.238-1.4 1.273-.65 2.148-2.02 2.148-3.6zm-12.5 4l-4-4 1.5-1.5 2.5 2.5 6-6 1.5 1.5-7.5 7.5z" fill="url(#goldGrad)" />
                                      <defs>
                                        <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                                          <stop offset="0%" stopColor="#FCD34D" />
                                          <stop offset="50%" stopColor="#F59E0B" />
                                          <stop offset="100%" stopColor="#D97706" />
                                        </linearGradient>
                                      </defs>
                                    </svg>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p className="font-extrabold text-amber-400">✦ Gold Founder Badge</p>
                                    <p className="text-[10px] text-neutral-400 mt-0.5">Exclusive Pro Member Status</p>
                                  </TooltipContent>
                                </Tooltip>
                              )}

                              {planType === 'lifetime' && (
                                <Tooltip delayDuration={150}>
                                  <TooltipTrigger asChild>
                                    <svg className="w-5 h-5 inline-block select-none filter drop-shadow-[0_0_6px_rgba(6,182,212,0.6)] animate-pulse transition-transform hover:scale-110 cursor-pointer shrink-0" viewBox="0 0 24 24" fill="currentColor">
                                      <path d="M12 2L2 12l10 10 10-10L12 2zm-1.5 14.5l-4-4 1.5-1.5 2.5 2.5 6-6 1.5 1.5-7.5 7.5z" fill="url(#diamondGrad)" />
                                      <defs>
                                        <linearGradient id="diamondGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                                          <stop offset="0%" stopColor="#22D3EE" />
                                          <stop offset="35%" stopColor="#6366F1" />
                                          <stop offset="70%" stopColor="#A855F7" />
                                          <stop offset="100%" stopColor="#EC4899" />
                                        </linearGradient>
                                      </defs>
                                    </svg>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p className="font-extrabold text-cyan-400">💎 Diamond Founder Badge</p>
                                    <p className="text-[10px] text-neutral-400 mt-0.5">Elite Lifetime Founding Member</p>
                                  </TooltipContent>
                                </Tooltip>
                              )}

                              {profile?.earned_badges?.includes('founding_member') && (
                                <Tooltip delayDuration={150}>
                                  <TooltipTrigger asChild>
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-gradient-to-r from-amber-400 via-orange-500 to-yellow-500 text-black shadow-[0_0_8px_rgba(245,158,11,0.6)] animate-pulse hover:scale-105 transition-transform duration-200 cursor-pointer select-none">
                                      ⭐ Founding Member
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p className="font-extrabold text-amber-400">⭐ Founding Member Badge</p>
                                    <p className="text-[10px] text-neutral-400 mt-0.5">One of the first 10 elite signups next</p>
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                            <p className="text-neutral-500 font-medium text-xs">
                              @{profile?.username || profile?.email?.split('@')[0]}
                            </p>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
                            <div>
                              <label className="block text-[9px] font-black uppercase tracking-wider text-neutral-500 mb-1">Display Name</label>
                              <input 
                                type="text"
                                value={formData.name}
                                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                                className="w-full px-4 py-2.5 bg-[#222] border border-white/5 rounded-2xl text-xs text-white focus:border-white/10 focus:outline-none transition-all font-sans"
                                placeholder="Enter display name"
                              />
                            </div>
                            <div>
                              <label className="block text-[9px] font-black uppercase tracking-wider text-neutral-500 mb-1">Handle</label>
                              <div className="relative font-sans">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500 text-xs font-semibold">@</span>
                                <input 
                                  type="text"
                                  value={formData.username}
                                  onChange={(e) => setFormData(prev => ({ ...prev, username: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') }))}
                                  className="w-full pl-8 pr-3 py-2.5 bg-[#222] border border-white/5 rounded-2xl text-xs text-white focus:border-white/10 focus:outline-none transition-all font-sans"
                                  placeholder="username"
                                />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Biography */}
                      <div>
                        {!isEditingProfile ? (
                          <p className="text-sm font-light text-neutral-300 leading-relaxed max-w-xl">
                            {profile?.bio || "No biography added yet. Click 'Edit Profile' to write a bio and personalize your Maily workspace."}
                          </p>
                        ) : (
                          <div>
                            <label className="block text-[9px] font-black uppercase tracking-wider text-neutral-500 mb-1">Biography</label>
                            <textarea 
                              value={formData.bio}
                              onChange={(e) => setFormData(prev => ({ ...prev, bio: e.target.value }))}
                              rows={2}
                              className="w-full px-4 py-2.5 bg-[#222] border border-white/5 rounded-2xl text-xs text-white focus:border-white/10 focus:outline-none transition-all resize-none font-sans"
                              placeholder="Tell us about yourself..."
                            />
                          </div>
                        )}
                      </div>

                      {/* Metadata Grid */}
                      <div className="border-t border-white/[0.04] pt-4">
                        {!isEditingProfile ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-y-3.5 gap-x-6 text-[11px] font-semibold text-neutral-400">
                            {/* Occupation */}
                            <div className="flex items-center gap-2">
                              <Briefcase className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                              <span>{profile?.work_status || 'Professional'}</span>
                            </div>
                            {/* Email (Private) */}
                            <div className="flex items-center gap-2">
                              <Mail className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                              <span className="font-mono">{profile?.email}</span>
                            </div>
                            {/* Location */}
                            {profile?.location && (
                              <div className="flex items-center gap-2">
                                <MapPin className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                                <span>{profile.location}</span>
                              </div>
                            )}
                            {/* Website */}
                            {profile?.website && profile?.website !== 'https://example.com' && (
                              <div className="flex items-center gap-2">
                                <LinkIcon className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                                <a href={profile.website.startsWith('http') ? profile.website : `https://${profile.website}`} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                                  {profile.website.replace(/^https?:\/\//, '')}
                                </a>
                              </div>
                            )}
                            {/* Joined Date */}
                            <div className="flex items-center gap-2">
                              <Calendar className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                              <span>Joined {profile?.created_at ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'May 2026'}</span>
                            </div>
                            {/* Active Plan */}
                            <div className="flex items-center gap-2">
                              <Shield className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                              {/* Every paid tier needs its own label. This chain used to end
                                  at 'starter', so BOTH weekly and annual subscribers were
                                  shown "Free Plan" on the page where they check what they
                                  are paying for. */}
                              <span className="capitalize">{planType === 'lifetime' ? 'Diamond Lifetime Founder' : (planType === 'annual' ? 'Golden Annual Plan' : (planType === 'pro' ? 'Golden Pro Plan' : (planType === 'weekly' ? 'Weekly Plan' : (planType === 'starter' ? 'Starter Plan' : 'Free Plan'))))}</span>
                            </div>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                            <div>
                              <label className="block text-[9px] font-black uppercase tracking-wider text-neutral-500 mb-1">Occupation</label>
                              <div className="relative font-sans">
                                <Briefcase className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-500" />
                                <input 
                                  type="text"
                                  value={formData.work_status}
                                  onChange={(e) => setFormData(prev => ({ ...prev, work_status: e.target.value }))}
                                  className="w-full pl-9 pr-3 py-2.5 bg-[#222] border border-white/5 rounded-2xl text-xs text-white focus:border-white/10 focus:outline-none transition-all font-sans"
                                  placeholder="e.g. Creator / AI Engineer"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="block text-[9px] font-black uppercase tracking-wider text-neutral-500 mb-1">Location</label>
                              <div className="relative font-sans">
                                <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-500" />
                                <input 
                                  type="text"
                                  value={formData.location}
                                  onChange={(e) => setFormData(prev => ({ ...prev, location: e.target.value }))}
                                  className="w-full pl-9 pr-3 py-2.5 bg-[#222] border border-white/5 rounded-2xl text-xs text-white focus:border-white/10 focus:outline-none transition-all font-sans"
                                  placeholder="City, Country"
                                />
                              </div>
                            </div>
                            <div>
                              <label className="block text-[9px] font-black uppercase tracking-wider text-neutral-500 mb-1">Website</label>
                              <div className="relative font-sans">
                                <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-500" />
                                <input 
                                  type="text"
                                  value={formData.website}
                                  onChange={(e) => setFormData(prev => ({ ...prev, website: e.target.value }))}
                                  className="w-full pl-9 pr-3 py-2.5 bg-[#222] border border-white/5 rounded-2xl text-xs text-white focus:border-white/10 focus:outline-none transition-all font-sans"
                                  placeholder="yourwebsite.com"
                                />
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                    </div>
                  </div>

                  {/* Partner Loop Conversion Section */}
                  <div>
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/[0.02] border border-white/[0.06] rounded-full text-[9px] font-bold tracking-widest uppercase text-neutral-400 mb-4 shadow-xl select-none">
                      <Sparkles className="w-3 h-3 text-neutral-400" />
                      Partner Opportunities
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Creator card */}
                      <div className="bg-[#111111] rounded-[24px] border border-white/5 p-6 flex flex-col justify-between hover:border-white/10 transition-all duration-300 shadow-lg relative overflow-hidden group">
                        <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/[0.02] to-transparent pointer-events-none" />
                        <div>
                          <div className="flex items-center justify-between mb-3 font-sans">
                            <h3 className="text-sm font-black text-white tracking-tight uppercase">✦ Apply as Creator</h3>
                            <span className="text-[9px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/10">70% RevShare</span>
                          </div>
                          <p className="text-[12px] font-light leading-relaxed text-neutral-400 mb-6 font-sans">
                            Join as an early AI engineer. Design and publish autonomous email workflow agents to our upcoming Boult Marketplace. Earn a lucrative 70% revenue share on every execution or subscription you power.
                          </p>
                        </div>
                        <button
                          onClick={() => openPartnerModal('creator')}
                          className="w-full py-2.5 rounded-xl bg-white/5 hover:bg-white text-white hover:text-black font-semibold text-xs active:scale-[0.98] transition-all flex items-center justify-center gap-2 border border-white/5 hover:border-white cursor-pointer shadow-md select-none font-sans"
                        >
                          Apply for Creator Loop
                        </button>
                      </div>

                      {/* Affiliate card */}
                      <div className="bg-[#111111] rounded-[24px] border border-white/5 p-6 flex flex-col justify-between hover:border-white/10 transition-all duration-300 shadow-lg relative overflow-hidden group">
                        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/[0.02] to-transparent pointer-events-none" />
                        <div>
                          <div className="flex items-center justify-between mb-3 font-sans">
                            <h3 className="text-sm font-black text-white tracking-tight uppercase">⚡ Apply as Affiliate</h3>
                            <span className="text-[9px] font-mono text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/10">30% commission</span>
                          </div>
                          <p className="text-[12px] font-light leading-relaxed text-neutral-400 mb-6 font-sans">
                            Become a Maily partner. Promote our autonomous inbox loop and earn a massive 30% recurring lifetime commission on all subscriptions you refer. No upfront payment required.
                          </p>
                        </div>
                        <button
                          onClick={() => openPartnerModal('affiliate')}
                          className="w-full py-2.5 rounded-xl bg-white/5 hover:bg-white text-white hover:text-black font-semibold text-xs active:scale-[0.98] transition-all flex items-center justify-center gap-2 border border-white/5 hover:border-white cursor-pointer shadow-md select-none font-sans"
                        >
                          Apply for Affiliate Loop
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Sync Settings */}
                  <div className="bg-[#111] rounded-[24px] border border-white/5 p-6 shadow-lg flex items-center justify-between">
                    <div>
                      <p className="text-xs font-bold text-white uppercase tracking-wider font-sans">Google Synchronization</p>
                      <p className="text-[11px] text-neutral-400 font-light mt-1 font-sans">Keep your profile and email analytics in sync with your Google account</p>
                    </div>
                    <button
                      onClick={handleSyncProfile}
                      disabled={syncing}
                      className="flex items-center gap-2 px-5 py-2.5 bg-neutral-900 border border-white/10 hover:border-white hover:bg-white/5 disabled:bg-neutral-950 text-white rounded-xl font-semibold text-xs transition-colors shrink-0 shadow-md cursor-pointer select-none font-sans"
                    >
                      {syncing ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Globe className="w-3.5 h-3.5 text-neutral-400" />
                      )}
                      {syncing ? 'Syncing...' : 'Sync Now'}
                    </button>
                  </div>
                </div>
              )}


              {/* Preferences Tab */}
              {activeTab === 'preferences' && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-lg font-medium mb-4">Preferences</h2>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          Theme
                        </label>
                        <select
                          value={formData.preferences.theme}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            preferences: { ...prev.preferences, theme: e.target.value as any }
                          }))}
                          className="w-full px-3 py-2 bg-[#2A2A2A] border border-[#444444] rounded-md text-white focus:outline-none focus:ring-2 focus:ring-[#2e2d2d]"
                        >
                          <option value="light">Light</option>
                          <option value="dark">Dark</option>
                          <option value="system">System</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          Language
                        </label>
                        <select
                          value={formData.preferences.language}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            preferences: { ...prev.preferences, language: e.target.value }
                          }))}
                          className="w-full px-3 py-2 bg-[#2A2A2A] border border-[#444444] rounded-md text-white focus:outline-none focus:ring-2 focus:ring-[#2e2d2d]"
                        >
                          <option value="en">English</option>
                          <option value="es">Español</option>
                          <option value="fr">Français</option>
                          <option value="de">Deutsch</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          Timezone
                        </label>
                        <select
                          value={formData.preferences.timezone}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            preferences: { ...prev.preferences, timezone: e.target.value }
                          }))}
                          className="w-full px-3 py-2 bg-[#2A2A2A] border border-[#444444] rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="UTC">UTC</option>
                          <option value="America/New_York">Eastern Time</option>
                          <option value="America/Chicago">Central Time</option>
                          <option value="America/Denver">Mountain Time</option>
                          <option value="America/Los_Angeles">Pacific Time</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          Date Format
                        </label>
                        <select
                          value={formData.preferences.date_format}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            preferences: { ...prev.preferences, date_format: e.target.value }
                          }))}
                          className="w-full px-3 py-2 bg-[#2A2A2A] border border-[#444444] rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                          <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                          <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Privacy Tab */}
              {activeTab === 'privacy' && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-lg font-medium mb-4">Privacy Settings</h2>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          Profile Visibility
                        </label>
                        <select
                          value={formData.privacy_settings.profile_visibility}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            privacy_settings: { ...prev.privacy_settings, profile_visibility: e.target.value as any }
                          }))}
                          className="w-full px-3 py-2 bg-[#2A2A2A] border border-[#444444] rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="public">Public</option>
                          <option value="contacts">Contacts Only</option>
                          <option value="private">Private</option>
                        </select>
                      </div>

                      <div className="space-y-3">
                        <label className="flex items-center">
                          <input
                            type="checkbox"
                            checked={formData.privacy_settings.show_online_status}
                            onChange={(e) => setFormData(prev => ({
                              ...prev,
                              privacy_settings: { ...prev.privacy_settings, show_online_status: e.target.checked }
                            }))}
                            className="mr-3 w-4 h-4 text-blue-600 bg-[#2A2A2A] border-[#444444] rounded focus:ring-blue-500"
                          />
                          Show online status to other users
                        </label>

                        <label className="flex items-center">
                          <input
                            type="checkbox"
                            checked={formData.privacy_settings.allow_direct_messages}
                            onChange={(e) => setFormData(prev => ({
                              ...prev,
                              privacy_settings: { ...prev.privacy_settings, allow_direct_messages: e.target.checked }
                            }))}
                            className="mr-3 w-4 h-4 text-blue-600 bg-[#2A2A2A] border-[#444444] rounded focus:ring-blue-500"
                          />
                          Allow direct messages from other users
                        </label>

                        <label className="flex items-center">
                          <input
                            type="checkbox"
                            checked={formData.privacy_settings.data_collection}
                            onChange={(e) => setFormData(prev => ({
                              ...prev,
                              privacy_settings: { ...prev.privacy_settings, data_collection: e.target.checked }
                            }))}
                            className="mr-3 w-4 h-4 text-blue-600 bg-[#2A2A2A] border-[#444444] rounded focus:ring-blue-500"
                          />
                          Allow data collection for service improvement
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Notifications Tab */}
              {activeTab === 'notifications' && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-lg font-medium mb-4">Notification Settings</h2>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                          Email Digest
                        </label>
                        <select
                          value={formData.notification_settings.email_digest}
                          onChange={(e) => setFormData(prev => ({
                            ...prev,
                            notification_settings: { ...prev.notification_settings, email_digest: e.target.value as any }
                          }))}
                          className="w-full px-3 py-2 bg-[#2A2A2A] border border-[#444444] rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="never">Never</option>
                          <option value="daily">Daily</option>
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                        </select>
                      </div>

                      <div className="space-y-3">
                        <label className="flex items-center">
                          <input
                            type="checkbox"
                            checked={formData.notification_settings.desktop_notifications}
                            onChange={(e) => setFormData(prev => ({
                              ...prev,
                              notification_settings: { ...prev.notification_settings, desktop_notifications: e.target.checked }
                            }))}
                            className="mr-3 w-4 h-4 text-blue-600 bg-[#2A2A2A] border-[#444444] rounded focus:ring-blue-500"
                          />
                          Enable desktop notifications
                        </label>

                        <label className="flex items-center">
                          <input
                            type="checkbox"
                            checked={formData.notification_settings.sound_enabled}
                            onChange={(e) => setFormData(prev => ({
                              ...prev,
                              notification_settings: { ...prev.notification_settings, sound_enabled: e.target.checked }
                            }))}
                            className="mr-3 w-4 h-4 text-blue-600 bg-[#2A2A2A] border-[#444444] rounded focus:ring-blue-500"
                          />
                          Play notification sounds
                        </label>

                        <label className="flex items-center">
                          <input
                            type="checkbox"
                            checked={formData.notification_settings.mention_notifications}
                            onChange={(e) => setFormData(prev => ({
                              ...prev,
                              notification_settings: { ...prev.notification_settings, mention_notifications: e.target.checked }
                            }))}
                            className="mr-3 w-4 h-4 text-blue-600 bg-[#2A2A2A] border-[#444444] rounded focus:ring-blue-500"
                          />
                          Notify when mentioned
                        </label>

                        <label className="flex items-center">
                          <input
                            type="checkbox"
                            checked={formData.notification_settings.reply_notifications}
                            onChange={(e) => setFormData(prev => ({
                              ...prev,
                              notification_settings: { ...prev.notification_settings, reply_notifications: e.target.checked }
                            }))}
                            className="mr-3 w-4 h-4 text-blue-600 bg-[#2A2A2A] border-[#444444] rounded focus:ring-blue-500"
                          />
                          Notify on replies
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Integrations Tab */}
              {activeTab === 'integrations' && (
                <div className="space-y-6">
                  <div>
                    <h2 className="text-lg font-medium mb-4">Integrations</h2>
                    <p className="text-gray-400 mb-6">Connect your favorite apps and services to enhance your experience.</p>
                    <button
                      onClick={() => setIsIntegrationsOpen(true)}
                      className="flex items-center gap-3 px-4 py-3 bg-[#2A2A2A] border border-[#444444] rounded-md text-white hover:bg-[#333333] transition-colors"
                    >
                      <Plug className="w-5 h-5" />
                      Manage Integrations
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Integrations Modal */}
      <IntegrationsModal
        isOpen={isIntegrationsOpen}
        onClose={() => setIsIntegrationsOpen(false)}
      />

      {/* Partner Application Modal */}
      {partnerModalType && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-6 bg-black/80 backdrop-blur-md transition-all duration-500 animate-fadeIn">
          <div className="absolute inset-0 z-0" onClick={() => setPartnerModalType(null)} />
          
          <div className="relative z-10 w-full max-w-[440px] rounded-[2.5rem] bg-[#0A0A0A] border border-[#2A2A2A] p-8 md:p-10 shadow-[0_32px_128px_-16px_rgba(0,0,0,0.8)] text-left flex flex-col gap-6 font-sans">
            <button 
              onClick={() => setPartnerModalType(null)}
              className="absolute top-6 right-6 p-2 rounded-full bg-white/5 hover:bg-white/10 text-white/20 hover:text-white transition-all shadow-sm focus:outline-none"
            >
              <CloseIcon className="w-4 h-4" />
            </button>

            <div className="space-y-2 mt-4 text-left">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/[0.03] border border-white/[0.08] text-[9px] font-mono tracking-wider uppercase text-neutral-400">
                Partner Loop // {partnerModalType === "creator" ? "Creator" : "Affiliate"}
              </span>
              <h3 className="text-xl font-bold text-white tracking-tight font-sans">
                {partnerModalType === "creator" ? "Apply as Creator" : "Apply as Affiliate"}
              </h3>
            </div>

            {!partnerSubmitted ? (
              <form onSubmit={handlePartnerSubmit} className="space-y-4">
                <p className="text-[13px] leading-relaxed text-neutral-400 font-light font-sans">
                  {partnerModalType === "creator" 
                    ? "Join as an early AI engineer. Design and publish autonomous email workflow agents to our upcoming Boult Marketplace. Earn a lucrative 70% revenue share on every execution or subscription you power."
                    : "Become a Maily partner. Promote our autonomous inbox loop and earn a massive 30% recurring lifetime commission on all subscriptions you refer. No upfront payment required."}
                </p>
                <div className="space-y-3">
                  <label className="text-[10px] font-bold tracking-wider uppercase text-neutral-500 block">Your Email</label>
                  <input
                    type="email"
                    required
                    value={partnerEmail}
                    onChange={(e) => setPartnerEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="w-full rounded-2xl bg-white/[0.03] border border-white/5 px-5 py-3.5 text-[14px] text-white placeholder:text-white/25 focus:border-white/10 focus:outline-none transition-all leading-normal"
                  />
                </div>
                <button
                  type="submit"
                  disabled={partnerSubmitting}
                  className="w-full py-3.5 rounded-2xl bg-white text-black font-bold text-sm active:scale-95 transition-all flex items-center justify-center gap-2 hover:bg-white/90 disabled:bg-neutral-800 disabled:text-neutral-500 disabled:cursor-not-allowed shadow-md cursor-pointer mt-2"
                >
                  {partnerSubmitting ? "Submitting..." : "Submit Application"}
                </button>
              </form>
            ) : (
              <div className="space-y-4 py-4 text-center flex flex-col items-center">
                <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 text-lg mb-2">
                  ✓
                </div>
                <h4 className="text-md font-bold text-white font-sans">Application Received!</h4>
                <p className="text-[12px] leading-relaxed text-neutral-400 font-light font-sans max-w-sm">
                  We have queued your email <span className="text-white font-medium">{partnerEmail}</span>. A founding partner will reach out within 24 hours with your revenue-share onboarding instructions.
                </p>
                <button
                  onClick={() => {
                    setPartnerModalType(null);
                    setPartnerSubmitted(false);
                  }}
                  className="px-6 py-2.5 rounded-xl border border-white/[0.08] bg-white/[0.02] text-white hover:bg-white/5 font-semibold text-xs transition-colors mt-4 cursor-pointer font-sans"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
        </div>
      </div>
    </TooltipProvider>
  );
}