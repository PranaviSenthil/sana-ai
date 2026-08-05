import { useState, useRef } from "react";
import { Settings, X, LogOut, Trash2, Edit3, UserPlus, Image as ImageIcon, Check, Search as SearchIcon, Copy } from "lucide-react";
import { useUpdateGroupMutation, StudyGroup, useSaveGroupMemberProfile, useGroupMemberProfile, useRemoveMemberMutation, useDeleteGroupMutation } from "@/hooks/use-study-groups";
import { useAuth } from "@/hooks/use-auth";
import { InviteMemberModal } from "./InviteMemberModal";
import { LearningProfileEditor, LearningProfile } from "./LearningProfileEditor";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useResolvedAvatar } from "@/hooks/use-resolved-avatar";
import { useNavigate } from "@tanstack/react-router";

interface GroupSettingsPanelProps {
  group: StudyGroup;
  members: any[];
  onClose: () => void;
}

export function GroupSettingsPanel({ group, members, onClose }: GroupSettingsPanelProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const updateMutation = useUpdateGroupMutation();
  const saveProfileMutation = useSaveGroupMemberProfile();
  const removeMemberMutation = useRemoveMemberMutation();
  const deleteGroupMutation = useDeleteGroupMutation();
  const { data: myProfile } = useGroupMemberProfile(group.id, user?.id);
  const resolvedAvatar = useResolvedAvatar(group.avatar_url || null);
  
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(group.name);
  const [subject, setSubject] = useState(group.subject || "");
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showProfileEditor, setShowProfileEditor] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isOwner = members.find(m => m.user_id === user?.id)?.role === "owner";
  const myMemberRecord = members.find(m => m.user_id === user?.id);

  const handleSaveSettings = () => {
    updateMutation.mutate({
      groupId: group.id,
      updates: { name, subject }
    }, {
      onSuccess: () => {
        setIsEditing(false);
        toast.success("Group settings updated");
      }
    });
  };

  const handleUpdateLearningProfile = async (profile: LearningProfile) => {
    if (!user) return;
    try {
      await saveProfileMutation.mutateAsync({
        group_id: group.id,
        user_id: user.id,
        ...profile
      });
      toast.success("Learning profile updated!");
      setShowProfileEditor(false);
    } catch (err: any) {
      toast.error("Failed to update profile: " + err.message);
    }
  };

  const handleCopyCode = () => {
    if (!group.invite_code) return;
    navigator.clipboard.writeText(group.invite_code);
    setCopiedCode(true);
    toast.success("Invite code copied to clipboard!");
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setUploadingImage(true);
      const fileExt = file.name.split(".").pop();
      const filePath = `group-avatars/${group.id}-${Math.random()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from("user-uploads")
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      await updateMutation.mutateAsync({
        groupId: group.id,
        updates: { avatar_url: filePath }
      });
      
      toast.success("Group image updated");
    } catch (error: any) {
      toast.error("Failed to upload image: " + error.message);
    } finally {
      setUploadingImage(false);
    }
  };

  const handleRemoveMember = async (userId: string) => {
    try {
      await removeMemberMutation.mutateAsync({ groupId: group.id, userId });
      toast.success("Member removed");
    } catch (error: any) {
      toast.error("Failed to remove member: " + error.message);
    }
  };

  const handleLeaveGroup = async () => {
    if (!user) return;
    if (confirm("Are you sure you want to leave this group?")) {
      try {
        await removeMemberMutation.mutateAsync({ groupId: group.id, userId: user.id });
        toast.success("You have left the group");
        navigate({ to: "/study-together" });
      } catch (error: any) {
        toast.error("Failed to leave group: " + error.message);
      }
    }
  };

  const handleDeleteGroup = async () => {
    if (confirm("Are you sure you want to delete this group? This cannot be undone.")) {
      try {
        await deleteGroupMutation.mutateAsync(group.id);
        toast.success("Group deleted");
        navigate({ to: "/study-together" });
      } catch (error: any) {
        toast.error("Failed to delete group: " + error.message);
      }
    }
  };

  return (
    <div className="absolute inset-0 z-[150] bg-background overflow-y-auto animate-in slide-in-from-bottom-4 duration-300">
      <div className="sticky top-0 z-10 flex items-center justify-between bg-background/80 backdrop-blur-xl px-5 py-4 border-b border-border">
        <h2 className="text-[18px] font-bold">Group Settings</h2>
        <button onClick={onClose} className="grid h-10 w-10 place-items-center rounded-full bg-muted">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="p-5 space-y-8 pb-32">
        {/* Profile / Avatar Section */}
        <div className="flex flex-col items-center gap-4">
          <div className="relative h-24 w-24 rounded-3xl overflow-hidden bg-primary/10">
            {group.avatar_url ? (
              <img src={resolvedAvatar} alt={group.name} className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full w-full place-items-center text-[32px] font-bold text-primary">
                {group.name.substring(0, 1)}
              </div>
            )}
            {isOwner && (
              <div 
                onClick={() => fileInputRef.current?.click()}
                className="absolute bottom-0 left-0 right-0 h-8 bg-black/50 backdrop-blur-md grid place-items-center cursor-pointer hover:bg-black/60 transition-colors"
              >
                {uploadingImage ? (
                  <span className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                ) : (
                  <ImageIcon className="h-4 w-4 text-white" />
                )}
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept="image/*"
                  onChange={handleImageUpload}
                />
              </div>
            )}
          </div>
          
          {isEditing && isOwner ? (
            <div className="w-full space-y-4 max-w-sm">
              <div>
                <label className="text-[12px] font-bold text-muted-foreground ml-1">Group Name</label>
                <input 
                  value={name} 
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 h-12 w-full rounded-2xl border border-border bg-card px-4 text-[15px] font-bold shadow-sm"
                />
              </div>
              <div>
                <label className="text-[12px] font-bold text-muted-foreground ml-1">Subject</label>
                <input 
                  value={subject} 
                  onChange={(e) => setSubject(e.target.value)}
                  className="mt-1 h-12 w-full rounded-2xl border border-border bg-card px-4 text-[15px] font-bold shadow-sm"
                />
              </div>
              <button 
                onClick={handleSaveSettings}
                disabled={updateMutation.isPending}
                className="w-full rounded-2xl bg-primary py-3.5 text-[15px] font-bold text-white shadow-sm"
              >
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </button>
            </div>
          ) : (
            <div className="text-center w-full max-w-sm">
              <h1 className="text-[24px] font-bold">{group.name}</h1>
              <p className="text-[14px] text-muted-foreground mt-1">{group.subject || "No subject"}</p>
              
              {group.invite_code && (
                <div className="mt-4 flex flex-col items-center justify-center p-4 bg-muted/30 rounded-2xl border border-border/50">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">Group Invite Code</p>
                  <div 
                    onClick={handleCopyCode}
                    className="flex items-center gap-3 bg-white border border-border/60 rounded-xl px-4 py-2 cursor-pointer hover:bg-gray-50 active:scale-[0.98] transition-all shadow-sm group"
                  >
                    <span className="text-[18px] font-black tracking-[0.2em] text-primary">{group.invite_code}</span>
                    <div className="h-6 w-[1px] bg-border/60"></div>
                    {copiedCode ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4 text-gray-400 group-hover:text-primary transition-colors" />}
                  </div>
                </div>
              )}

              {isOwner && (
                <button onClick={() => setIsEditing(true)} className="mt-4 flex items-center gap-1.5 mx-auto rounded-full bg-muted px-4 py-1.5 text-[13px] font-bold hover:bg-gray-200 transition-colors">
                  <Edit3 className="h-3.5 w-3.5" /> Edit Info
                </button>
              )}
            </div>
          )}
        </div>

        {/* Member Skills Section (Step 10) */}
        <div className="rounded-[24px] border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-[16px] font-bold">My Learning Profile</h3>
            <button 
              onClick={() => setShowProfileEditor(true)}
              className="text-[13px] font-bold text-primary hover:underline"
            >
              Edit Skills
            </button>
          </div>
          <p className="text-[13px] text-muted-foreground leading-relaxed">
            Sana AI uses your strong areas and learning preferences to automatically distribute group tasks effectively.
          </p>
        </div>

        {/* Members Management (Step 7 & 8) */}
        <div className="rounded-[24px] border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-[16px] font-bold">Members ({members.length})</h3>
          </div>
          
          <div className="space-y-4">
            {members.map((m: any) => (
              <div key={m.user_id} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <img src={m.profiles?.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${m.profiles?.username}`} alt="avatar" className="h-10 w-10 rounded-full object-cover bg-muted" />
                  <div>
                    <p className="text-[14px] font-bold leading-tight">
                      {m.profiles?.display_name} {m.user_id === user?.id && "(You)"}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[12px] text-muted-foreground capitalize">{m.role}</span>
                      {m.status === 'invited' ? (
                        <span className="rounded-md bg-blue-100 px-1.5 py-0.5 text-[10px] font-bold text-blue-700 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span> Invited</span>
                      ) : m.status === 'declined' ? (
                        <span className="rounded-md bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-500"></span> Declined</span>
                      ) : m.group_member_profiles?.completed_at ? (
                        <span className="rounded-md bg-green-100 px-1.5 py-0.5 text-[10px] font-bold text-green-700 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500"></span> Profile Completed</span>
                      ) : (
                        <span className="rounded-md bg-yellow-100 px-1.5 py-0.5 text-[10px] font-bold text-yellow-700 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-yellow-500"></span> Pending</span>
                      )}
                    </div>
                  </div>
                </div>
                {isOwner && m.user_id !== user?.id && (
                  <button 
                    onClick={() => handleRemoveMember(m.user_id)}
                    disabled={removeMemberMutation.isPending}
                    className="text-[12px] font-bold text-red-500 hover:bg-red-50 px-2 py-1 rounded-md"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>

          {isOwner && (
            <button 
              onClick={() => setShowInviteModal(true)}
              className="w-full mt-5 flex items-center justify-center gap-2 rounded-2xl bg-indigo-50 border border-indigo-100 py-3.5 text-[14px] font-bold text-indigo-600 hover:bg-indigo-100 transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            >
              <SearchIcon className="h-4 w-4" aria-hidden="true" /> 
              <span>Find & Invite New Members</span>
            </button>
          )}
        </div>

        {/* Danger Zone */}
        <div className="space-y-3">
          <button 
            onClick={handleLeaveGroup}
            disabled={removeMemberMutation.isPending}
            className="w-full flex items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50/50 py-4 text-[15px] font-bold text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 transition-colors"
          >
            <LogOut className="h-5 w-5" aria-hidden="true" /> Leave Group
          </button>
          
          {isOwner && (
            <button 
              onClick={handleDeleteGroup}
              disabled={deleteGroupMutation.isPending}
              className="w-full flex items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50/50 py-4 text-[15px] font-bold text-red-600 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 transition-colors"
            >
              <Trash2 className="h-5 w-5" aria-hidden="true" /> Delete Group
            </button>
          )}
        </div>
      </div>

      {showInviteModal && (
        <InviteMemberModal 
          groupId={group.id} 
          groupName={group.name} 
          onClose={() => setShowInviteModal(false)} 
        />
      )}

      {showProfileEditor && myMemberRecord && (
        <div className="fixed inset-0 z-[200] bg-background pt-10 overflow-y-auto">
          <LearningProfileEditor 
            initialProfile={myProfile ? { ...myProfile, teaching_preference: myProfile.teaching_preference || undefined } : undefined}
            onSave={handleUpdateLearningProfile}
            onCancel={() => setShowProfileEditor(false)}
          />
        </div>
      )}
    </div>
  );
}
