import { X, Check, Trash2 as Trash, BellRing as BellRinging } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useNotificationStore } from '@/stores/notificationStore';

interface NotificationDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

function NotificationDrawer({ isOpen, onClose }: NotificationDrawerProps) {
  const { notifications, markAsRead, markAllAsRead } = useNotificationStore();

  if (!isOpen) return null;

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <>
      {/* Backdrop overlay */}
      <div 
        className="fixed inset-0 z-40 bg-slate-900/20 backdrop-blur-sm animate-in fade-in duration-300"
        onClick={onClose}
      />
      
      {/* Drawer Panel */}
      <div className="fixed inset-y-0 right-0 z-50 w-full md:w-[420px] bg-white/90 backdrop-blur-2xl shadow-[0_0_40px_rgba(0,0,0,0.1)] border-l border-white/50 flex flex-col animate-in slide-in-from-right duration-300">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-200/50 flex items-center justify-between bg-gradient-to-r from-white/50 to-transparent">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-brand-teal text-white rounded-lg shadow-md shadow-brand-teal/20">
              <BellRinging size={20} />
            </div>
            <div>
              <h3 className="font-sans text-xl font-extrabold text-slate-800 tracking-tight">Notifications</h3>
              <p className="font-sans text-xs text-slate-500 font-medium">
                {unreadCount > 0 ? `You have ${unreadCount} new alerts` : 'All caught up'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button 
                onClick={markAllAsRead}
                className="px-3 py-1.5 flex items-center gap-1.5 text-xs font-bold text-brand-teal bg-brand-teal/10 hover:bg-brand-teal/20 rounded-full transition-colors"
                title="Mark all as read"
              >
                <Check size={14} />
                Mark all read
              </button>
            )}
            <button 
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100/80 rounded-full transition-all hover:rotate-90 duration-300"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8 text-center gap-4 animate-in fade-in zoom-in duration-500">
              <div className="w-24 h-24 bg-slate-100 rounded-full flex items-center justify-center shadow-inner">
                <Trash size={40} className="text-slate-300" />
              </div>
              <div>
                <p className="font-sans text-lg font-bold text-slate-600">Inbox Zero</p>
                <p className="font-sans text-sm text-slate-400 mt-1">No notifications yet. You're all caught up!</p>
              </div>
            </div>
          ) : (
            notifications.map(notification => (
              <div 
                key={notification.id} 
                className={`relative overflow-hidden p-4 rounded-xl transition-all duration-300 cursor-pointer border ${
                  notification.read 
                    ? 'bg-white/60 border-slate-200/50 hover:bg-white hover:shadow-sm' 
                    : 'bg-white border-brand-teal/10 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] hover:shadow-[0_8px_25px_-5px_rgba(0,0,0,0.1)] hover:-translate-y-0.5'
                }`}
                onClick={() => markAsRead(notification.id)}
              >
                {/* Unread indicator bar */}
                {!notification.read && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-brand-teal to-brand-green" />
                )}
                
                <div className="flex justify-between items-start mb-2 ml-1">
                  <h4 className={`font-sans text-[15px] ${notification.read ? 'font-semibold text-slate-600' : 'font-extrabold text-slate-800 tracking-tight'}`}>
                    {notification.title}
                  </h4>
                  <span className={`text-[11px] font-bold tracking-wide shrink-0 ml-3 ${notification.read ? 'text-slate-400' : 'text-brand-teal'}`}>
                    {formatDistanceToNow(new Date(notification.timestamp), { addSuffix: true })}
                  </span>
                </div>
                <p className={`font-sans text-sm ml-1 ${notification.read ? 'text-slate-500' : 'text-slate-600 font-medium leading-relaxed'}`}>
                  {notification.message}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}

export default NotificationDrawer;
