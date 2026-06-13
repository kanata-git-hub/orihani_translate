import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../lib/firebaseUtils';
import { collection, onSnapshot, doc, setDoc, deleteDoc } from 'firebase/firestore';

interface ApprovedUser {
  id: string;
  email: string;
  role: 'user' | 'admin';
}

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [users, setUsers] = useState<ApprovedUser[]>([]);
  const [emailInput, setEmailInput] = useState('');
  const [roleInput, setRoleInput] = useState<'user' | 'admin'>('user');

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'approved_users'), (snap) => {
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as ApprovedUser));
      setUsers(data);
    }, (error) => {
      console.error("Error fetching users:", error);
    });
    return () => unsub();
  }, []);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput.trim()) return;

    try {
      const docRef = doc(collection(db, 'approved_users'));
      await setDoc(docRef, { email: emailInput.trim(), role: roleInput });
      setEmailInput('');
    } catch (err: any) {
      alert("Failed to add user: " + err.message);
    }
  };

  const handleRemoveUser = async (id: string) => {
    if (!confirm("Are you sure you want to remove this user?")) return;
    try {
      await deleteDoc(doc(db, 'approved_users', id));
    } catch (err: any) {
       alert("Failed to remove user: " + err.message);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Admin Dashboard</h1>
          <button 
            onClick={() => navigate('/app')}
            className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Go to Main App
          </button>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4">Approve New User</h2>
          <form onSubmit={handleAddUser} className="flex gap-4 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input 
                type="email" 
                value={emailInput}
                onChange={e => setEmailInput(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="user@example.com"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
              <select 
                value={roleInput}
                onChange={e => setRoleInput(e.target.value as 'user' | 'admin')}
                className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none truncate pr-8"
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <button 
              type="submit"
              className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors h-11"
            >
              Add User
            </button>
          </form>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-left">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Role</th>
                <th className="px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider w-24">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {users.map(u => (
                <tr key={u.id}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{u.email}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      u.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-green-100 text-green-800'
                    }`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm">
                    <button 
                      onClick={() => handleRemoveUser(u.id)}
                      className="text-red-600 hover:text-red-900 font-medium"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-6 py-8 text-center text-gray-500 text-sm">
                    No users approved yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}
