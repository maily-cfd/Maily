"use client";

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Mail,
  Bell,
  User,
  MoreHorizontal,
  Calendar,
  MapPin,
  Link as LinkIcon,
  Check
} from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';
import { Feed } from '@/components/ui/feed';

interface ProfileUser {
  id: string;
  name: string;
  username: string;
  avatar: string;
  bio?: string;
  location?: string;
  website?: string;
  isVerified?: boolean;
  joinedDate?: string;
  following?: number;
  followers?: number;
}

export default function AetherProfilePage() {
  const params = useParams();
  const router = useRouter();
  const userId = params.id as string;
  const [following, setFollowing] = useState<boolean>(false);
  const [profile, setProfile] = useState<ProfileUser | null>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [isFollowingYou, setIsFollowingYou] = useState<boolean>(false);

  useEffect(() => {
    document.title = `@${userId} / Maily`;

    // Load following state
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('maily_following');
      if (stored) {
        try {
          const followingSet = new Set(JSON.parse(stored));
          setFollowing(followingSet.has(userId));
        } catch (error) {
          console.error('Error loading following state:', error);
        }
      }
    }

    // Load profile data (mock for now)
    // TODO: Replace with actual API call
    const mockProfile: ProfileUser = {
      id: userId,
      name: userId === 'rrhoover' ? 'Ryan Hoover' :
        userId === 'imbktan' ? 'Jacky' :
          userId === 'yongfook' ? 'Jon Yongfook' :
            userId === 'damengchen' ? 'Damon Chen' :
              userId === 'dannypostmaa' ? 'Danny Postma' :
                'User Name',
      username: userId,
      avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`,
      bio: userId === 'damengchen' ? 'Founder of Testimonial.to and PDF.ai' :
        'Building the future of email communication and relationship intelligence.',
      location: 'San Francisco, CA',
      website: 'https://example.com',
      isVerified: ['rrhoover', 'imbktan', 'yongfook', 'damengchen', 'dannypostmaa'].includes(userId),
      joinedDate: 'January 2020',
      following: Math.floor(Math.random() * 500) + 100,
      followers: Math.floor(Math.random() * 5000) + 1000,
    };
    setProfile(mockProfile);

    // Load user posts (mock)
    const mockPosts = [
      {
        id: `post_${Date.now()}`,
        user: {
          avatar: mockProfile.avatar,
          username: mockProfile.username,
          displayName: mockProfile.name
        },
        timestamp: '2h',
        content: 'Just shipped a new feature! Excited to see how it helps our users improve their email workflow. 🚀',
        engagement: {
          likes: Math.floor(Math.random() * 100) + 10,
          comments: Math.floor(Math.random() * 20) + 2,
          shares: Math.floor(Math.random() * 10) + 1
        },
        isLiked: false,
        isBookmarked: false
      }
    ];
    setPosts(mockPosts);

    // TODO: Replace with actual API call to check if user is following you
    // Mock: Randomly set if user is following you
    setIsFollowingYou(Math.random() > 0.5);
  }, [userId]);

  const handleFollow = () => {
    if (!profile) return;

    const wasFollowing = following;
    setFollowing(!following);

    // Update localStorage
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('maily_following');
      let followingSet = new Set<string>();
      if (stored) {
        try {
          followingSet = new Set(JSON.parse(stored));
        } catch (error) {
          console.error('Error loading following state:', error);
        }
      }

      if (wasFollowing) {
        followingSet.delete(userId);
      } else {
        followingSet.add(userId);
      }

      localStorage.setItem('maily_following', JSON.stringify(Array.from(followingSet)));
    }
  };

  if (!profile) {
    return (
      <div className="satoshi-home-feed flex h-screen w-full text-white items-center justify-center">
        <div>Loading...</div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="satoshi-home-feed flex h-screen w-full text-white overflow-hidden" style={{
        background: '#000000'
      }}>
        {/* Universal Sidebar */}
        <div className="fixed left-0 top-0 h-screen w-20 bg-[#0a0a0a]/50 backdrop-blur-sm border-r border-[#525252] hidden sm:flex flex-col z-20">
          <div className="flex flex-col items-end py-24 gap-6 pr-4">
            <Tooltip delayDuration={100}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => router.push('/home-feed')}
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


          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col ml-0 sm:ml-20 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {/* Header */}
          <div className="w-full bg-black border-b border-gray-800 flex-shrink-0 sticky top-0 z-10">
            <div className="flex items-center gap-4 px-4 py-3">
              <button
                onClick={() => router.back()}
                className="p-2 hover:bg-[#1a1a1a] rounded-full transition-all duration-200"
                aria-label="Back"
              >
                <ArrowLeft className="w-5 h-5 text-white" />
              </button>
              <div className="flex-1">
                <h2 className="text-white font-bold text-xl">{profile.name}</h2>
                <p className="text-gray-400 text-sm">{posts.length} Posts</p>
              </div>
            </div>
          </div>

          {/* Profile Header */}
          <div className="w-full bg-black">
            {/* Profile Info */}
            <div className="px-6 pb-4 pt-6">
              {/* Avatar and Follow Button */}
              <div className="flex justify-between items-start mb-4">
                <div className="relative">
                  <img
                    src={profile.avatar}
                    alt={profile.name}
                    className="w-32 h-32 rounded-full border-4 border-black"
                  />
                </div>
                <button
                  onClick={handleFollow}
                  className={`px-6 py-2.5 rounded-full font-bold text-[15px] transition-all duration-200 relative overflow-hidden group mt-4 ${following
                    ? ''
                    : 'hover:bg-[#e6e6e6]'
                    }`}
                  style={following
                    ? {
                      backgroundColor: '#2b2b2b',
                      color: '#fafafa',
                      border: '1px solid #474747'
                    }
                    : {
                      backgroundColor: '#fafafa',
                      color: '#000'
                    }
                  }
                >
                  <span className={`transition-opacity duration-200 ${following ? 'group-hover:opacity-0' : ''}`}>
                    {following ? 'Following' : 'Follow'}
                  </span>
                  {following && (
                    <span
                      className="absolute inset-0 flex items-center justify-center transition-opacity duration-200 opacity-0 group-hover:opacity-100"
                      style={{ backgroundColor: '#fafafa', color: '#000' }}
                    >
                      Unfollow
                    </span>
                  )}
                </button>
              </div>

              {/* Name and Username */}
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-1">
                  <h1 className="text-white font-bold text-2xl">{profile.name}</h1>
                  {profile.isVerified && (
                    <div className="w-6 h-6 rounded-full bg-[#1d9bf0] flex items-center justify-center">
                      <Check className="w-4 h-4 text-white" />
                    </div>
                  )}
                </div>
                <p className="text-gray-400 text-[15px]">@{profile.username}</p>
              </div>

              {/* Bio */}
              {profile.bio && (
                <p className="text-white text-[15px] mb-4">{profile.bio}</p>
              )}

              {/* Meta Info */}
              <div className="flex flex-wrap items-center gap-4 text-[15px] text-gray-400 mb-4">
                {profile.location && (
                  <div className="flex items-center gap-1">
                    <MapPin className="w-4 h-4" />
                    <span>{profile.location}</span>
                  </div>
                )}
                {profile.website && (
                  <div className="flex items-center gap-1">
                    <LinkIcon className="w-4 h-4" />
                    <a
                      href={profile.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#1d9bf0] hover:underline"
                    >
                      {profile.website.replace(/^https?:\/\//, '')}
                    </a>
                  </div>
                )}
                {profile.joinedDate && (
                  <div className="flex items-center gap-1">
                    <Calendar className="w-4 h-4" />
                    <span>Joined {profile.joinedDate}</span>
                  </div>
                )}
              </div>

              {/* Follow Status */}
              <div className="text-[15px] text-gray-400">
                {isFollowingYou ? (
                  <span>Following you. </span>
                ) : (
                  <span>Not following</span>
                )}
              </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-800">
              <button className="flex-1 px-4 py-4 text-[15px] font-medium text-white border-b-2 border-white">
                Posts
              </button>
            </div>
          </div>

          {/* Posts */}
          <div>
            {posts.length > 0 ? (
              <Feed
                posts={posts}
                hasMore={false}
                isLoading={false}
                user={{
                  avatar: profile.avatar,
                  displayName: profile.name,
                  username: profile.username
                }}
              />
            ) : (
              <div className="text-center py-12">
                <p className="text-gray-500">No posts yet.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}

