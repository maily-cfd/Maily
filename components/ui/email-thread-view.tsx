"use client";

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { 
  Reply, 
  ReplyAll, 
  Forward,
  Calendar,
  MoreVertical,
  Star,
  Archive,
  Trash2,
  Clock,
  User,
  Lightbulb,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  X
} from 'lucide-react';

interface EmailMessage {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  fromName: string;
  to: string;
  date: string;
  body: string;
  isHtml: boolean;
  isRead: boolean;
  isImportant: boolean;
  labels: string[];
  attachments?: Array<{
    filename: string;
    mimeType: string;
    size: number;
    attachmentId: string;
  }>;
}

interface ThreadViewProps {
  threadId: string;
  emailId?: string;
  onClose: () => void;
  onAction?: (action: string, data?: any) => void;
}

export function EmailThreadView({ threadId, emailId, onClose, onAction }: ThreadViewProps) {
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [selectedMessage, setSelectedMessage] = useState<EmailMessage | null>(null);
  const [replyText, setReplyText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [aiSummary, setAiSummary] = useState<string>('');
  const [suggestedReplies, setSuggestedReplies] = useState<string[]>([]);
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledTime, setScheduledTime] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isScheduling, setIsScheduling] = useState(false);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');

  useEffect(() => {
    loadThread();
  }, [threadId]);

  const loadThread = async () => {
    setIsLoading(true);
    setError('');
    setAiSummary('');
    setSuggestedReplies([]);
    try {
      const response = await fetch(`/api/gmail/threads/${threadId}`);
      if (response.ok) {
        const data = await response.json();
        const msgs = data.messages || [];
        setMessages(msgs);
        setSelectedMessage(msgs.length ? msgs[msgs.length - 1] : null);
      } else {
        setMessages([]);
        setSelectedMessage(null);
        setError('Could not load this thread. Try again.');
      }
    } catch (error) {
      console.error('Error loading thread:', error);
      setMessages([]);
      setSelectedMessage(null);
      setError('Could not load this thread. Try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString([], { 
      month: 'short', 
      day: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  };

  const handleSendReply = async () => {
    if (!replyText.trim()) return;

    setIsSending(true);
    setError('');
    setSuccess('');

    try {
      const response = await fetch('/api/gmail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: selectedMessage?.from,
          subject: `Re: ${selectedMessage?.subject}`,
          body: replyText,
          isHtml: false
        })
      });

      if (response.ok) {
        setReplyText('');
        setSuccess('Reply sent successfully!');
        // Reload thread to show new message
        loadThread();
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to send reply');
      }
    } catch (error) {
      console.error('Error sending reply:', error);
      setError('Network error. Please check your connection and try again.');
    } finally {
      setIsSending(false);
    }
  };

  const handleScheduleEmail = async () => {
    if (!scheduledTime) return;

    setIsScheduling(true);
    setError('');
    setSuccess('');

    try {
      const response = await fetch('/api/calendar/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summary: `Follow up: ${selectedMessage?.subject}`,
          description: `Scheduled email follow-up for thread: ${threadId}`,
          startTime: scheduledTime,
          duration: 30
        })
      });

      if (response.ok) {
        setIsScheduled(true);
        setSuccess('Email scheduled successfully!');
        onAction?.('email-scheduled', { scheduledTime, threadId });
      } else {
        const errorData = await response.json();
        setError(errorData.error || 'Failed to schedule email');
      }
    } catch (error) {
      console.error('Error scheduling email:', error);
      setError('Network error. Please check your connection and try again.');
    } finally {
      setIsScheduling(false);
    }
  };

  const handleSuggestedReply = (reply: string) => {
    setReplyText(reply);
  };

  const handleAssignToTeam = (memberId: string) => {
    onAction?.('assign-to-team', { threadId, memberId });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="flex h-full bg-white">
      {/* Main Thread View */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="border-b border-gray-200 p-4">
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-xl font-semibold text-gray-900">
              {selectedMessage?.subject || 'Email Thread'}
            </h1>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
          
          <div className="flex items-center space-x-4 text-sm text-gray-600">
            <span>{messages.length} messages</span>
            <div className="flex items-center space-x-2">
              <Button variant="ghost" size="sm">
                <Star className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm">
                <Archive className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm">
                <Trash2 className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="sm">
                <MoreVertical className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-auto">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`border-b border-gray-100 p-4 hover:bg-gray-50 cursor-pointer ${
                selectedMessage?.id === message.id ? 'bg-blue-50 border-l-4 border-l-blue-500' : ''
              }`}
              onClick={() => setSelectedMessage(message)}
            >
              <div className="flex items-start space-x-3">
                <Avatar className="w-8 h-8">
                  <AvatarFallback>{message.fromName[0]}</AvatarFallback>
                </Avatar>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center space-x-2">
                      <span className="font-medium text-gray-900">{message.fromName}</span>
                      <span className="text-sm text-neutral-600 dark:text-gray-500">{`<${message.from}>`}</span>
                      {message.isImportant && (
                        <Star className="w-4 h-4 text-yellow-500 fill-current" />
                      )}
                    </div>
                    <span className="text-xs text-neutral-600 dark:text-gray-500">
                      {formatDate(message.date)}
                    </span>
                  </div>
                  
                  <div className="text-sm text-gray-700 whitespace-pre-wrap mb-2">
                    {message.body}
                  </div>
                  
                  {message.labels && message.labels.length > 0 && (
                    <div className="flex items-center space-x-1">
                      {message.labels.map((label, index) => (
                        <Badge key={index} variant="outline" className="text-xs">
                          {label}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Reply Composer */}
        <div className="border-t border-gray-200 p-4">
          {suggestedReplies.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-medium text-gray-700 mb-2 flex items-center">
                <Lightbulb className="w-4 h-4 mr-1 text-yellow-500" />
                AI Suggested Replies
              </h4>
              <div className="space-y-2">
                {suggestedReplies.map((reply, index) => (
                  <button
                    key={index}
                    onClick={() => handleSuggestedReply(reply)}
                    className="block w-full text-left p-3 bg-gray-50 hover:bg-gray-100 rounded-lg text-sm transition-colors"
                  >
                    {reply}
                  </button>
                ))}
              </div>
            </div>
          )}
          
          <div className="space-y-3">
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
                {error}
              </div>
            )}
            {success && (
              <div className="bg-green-50 border border-green-200 text-green-700 px-3 py-2 rounded-lg text-sm">
                {success}
              </div>
            )}
            <textarea
              placeholder="Type your reply..."
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              className="w-full h-24 p-3 border border-gray-300 rounded-lg resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Button variant="outline" size="sm">
                  <Reply className="w-4 h-4 mr-1" />
                  Reply
                </Button>
                <Button variant="outline" size="sm">
                  <ReplyAll className="w-4 h-4 mr-1" />
                  Reply All
                </Button>
                <Button variant="outline" size="sm">
                  <Forward className="w-4 h-4 mr-1" />
                  Forward
                </Button>
              </div>
              
              <div className="flex items-center space-x-2">
                {!isScheduled ? (
                  <div className="flex items-center space-x-2">
                    <Input
                      type="datetime-local"
                      value={scheduledTime}
                      onChange={(e) => setScheduledTime(e.target.value)}
                      className="text-xs"
                      placeholder="Schedule send"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleScheduleEmail}
                      disabled={!scheduledTime || isScheduling}
                    >
                      <Clock className="w-4 h-4 mr-1" />
                      {isScheduling ? 'Scheduling...' : 'Schedule'}
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center space-x-2 text-green-600">
                    <CheckCircle className="w-4 h-4" />
                    <span className="text-sm">Scheduled</span>
                  </div>
                )}
                
                <Button
                  onClick={handleSendReply}
                  disabled={!replyText.trim() || isSending}
                >
                  {isSending ? 'Sending...' : 'Send'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Context Sidebar */}
      <div className="w-80 bg-gray-50 border-l border-gray-200 flex flex-col">
        {/* AI Summary */}
        <div className="p-4 border-b border-gray-200">
          <h3 className="text-sm font-medium text-gray-900 mb-2 flex items-center">
            <Lightbulb className="w-4 h-4 mr-1 text-blue-500" />
            AI Summary
          </h3>
          <p className="text-sm text-gray-700 bg-blue-50 p-3 rounded-lg">
            {aiSummary}
          </p>
        </div>

        {/* Thread Insights */}
        <div className="p-4 border-b border-gray-200">
          <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center">
            <TrendingUp className="w-4 h-4 mr-1 text-green-500" />
            Thread Insights
          </h3>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Response Time</span>
              <span className="font-medium">2 hours</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Sentiment</span>
              <span className="font-medium text-green-600">Positive</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Priority</span>
              <Badge className="bg-yellow-100 text-yellow-800">High</Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Next Action</span>
              <span className="font-medium">Meeting Thursday</span>
            </div>
          </div>
        </div>

        {/* Team Assignment */}
        <div className="p-4 border-b border-gray-200">
          <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center">
            <User className="w-4 h-4 mr-1 text-purple-500" />
            Assign to Team
          </h3>
          <div className="space-y-2">
            {[
              { id: '1', name: 'Sarah Johnson', status: 'online' },
              { id: '2', name: 'Mike Chen', status: 'away' },
              { id: '3', name: 'Alex Rivera', status: 'online' }
            ].map((member) => (
              <button
                key={member.id}
                className="w-full flex items-center space-x-2 p-2 rounded-lg hover:bg-gray-100 transition-colors"
                onClick={() => handleAssignToTeam(member.id)}
              >
                <Avatar className="w-6 h-6">
                  <AvatarFallback>{member.name[0]}</AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left">
                  <div className="text-sm font-medium text-gray-900">{member.name}</div>
                  <div className="text-xs text-neutral-600 dark:text-gray-500 capitalize">{member.status}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="p-4 flex-1">
          <h3 className="text-sm font-medium text-gray-900 mb-3">Quick Actions</h3>
          <div className="space-y-2">
            <Button 
              variant="outline" 
              className="w-full justify-start text-sm"
              onClick={() => onAction?.('create-meeting', { threadId })}
            >
              <Calendar className="w-4 h-4 mr-2" />
              Schedule Meeting
            </Button>
            <Button 
              variant="outline" 
              className="w-full justify-start text-sm"
              onClick={() => onAction?.('add-to-crm', { threadId })}
            >
              <User className="w-4 h-4 mr-2" />
              Add to CRM
            </Button>
            <Button 
              variant="outline" 
              className="w-full justify-start text-sm"
              onClick={() => onAction?.('set-reminder', { threadId })}
            >
              <Clock className="w-4 h-4 mr-2" />
              Set Reminder
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
