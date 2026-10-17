import { createContext, useContext, useState, useEffect } from 'react';
import { adminAPI } from '../services/communication.jsx';

const UserContext = createContext();

export const useUser = () => {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
};

export const UserProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Fetch user profile
  const fetchUserProfile = async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      setUser(null);
      return;
    }
    // Distributor tokens are not admin tokens — the admin profile endpoint
    // would 401 and the axios interceptor would log them straight out.
    if (localStorage.getItem('role') === 'distributor') {
      setUser(JSON.parse(localStorage.getItem('userData') || 'null'));
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await adminAPI.getProfile();

      if (result.success) {
        setUser(result.data);
      } 

    setLoading(false);
    } catch (err) {
      setError('Failed to fetch user profile.');
      setLoading(false);
    }   
  };

  // Update user profile
  const updateUserProfile = async (updatedData) => {
    const token = localStorage.getItem('token');
    if (!token) return false;

    setLoading(true);

    const result = await adminAPI.updateProfile(updatedData);

    if (result.success) {
      setUser(prev => ({ ...prev, ...updatedData }));
      setLoading(false);
      return true;
    } else {
      setError(result.message);
      setLoading(false);
      return false;
    }
  };

  // Logout function
  const logout = () => {
    localStorage.removeItem('token');
    setUser(null);
    setError(null);
  };

  // Load profile on mount if token exists
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token && !user) {
      fetchUserProfile();
    }
  }, []);

  const value = {
    user,
    loading,
    error,
    fetchUserProfile,
    updateUserProfile,
    logout,
    setUser
  };

  return (
    <UserContext.Provider value={value}>
      {children}
    </UserContext.Provider>
  );
};

export default UserContext;
