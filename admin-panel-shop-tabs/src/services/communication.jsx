import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://backend.mynaai.in";
// const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "http://192.168.1.18:5003";

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
});

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;

    } else {
      console.warn('API Request without token:', config.url);
    }
    return config;
  },
  (error) => {
    console.error('Request interceptor error:', error);
    return Promise.reject(error);
  }
);

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => {

    return response;
  },
  (error) => {
    console.error('API Error Response:', {
      url: error.config?.url,
      method: error.config?.method,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message
    });

    if (error.response?.status === 401) {
      // Token expired or invalid
      console.warn('401 Unauthorized - clearing token and redirecting to login');
      localStorage.removeItem('token');
      localStorage.removeItem('role');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);


// ==================== ADMIN AUTHENTICATION ====================
export const adminAPI = {
  // Admin login
  login: async (credentials) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/api/admin/login`, credentials);
      return {
        success: response.data?.status === "SUCCESS",
        data: response.data?.data,
        message: response.data?.message
      };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || "Login failed",
        error: error.response?.data
      };
    }
  },

  // Change admin password 
  changePassword: async (passwordData) => {
    try {
      const response = await api.post('/api/admin/change-password', passwordData);
      return {
        success: response.data?.status === "SUCCESS",
        data: response.data?.data,
        message: response.data?.message
      };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || "Failed to change password",
        error: error.response?.data
      };
    }
  },

  // Get admin profile - actual API integration
  getProfile: async () => {
    try {
      const response = await api.get('/api/admin/profile');

      return {
        success: response.data?.status === "SUCCESS",
        data: response.data?.data,
        message: response.data?.message || "Profile fetched successfully"
      };
    } catch (error) {
      console.error("Profile API error:", error);

      // For network errors, return mock data for development
      if (error.code === 'ERR_NETWORK' || !error.response) {
        console.warn("Backend server not responding, using mock profile data");
      }

      return {
        success: false,
        message: error.response?.data?.message || "Failed to fetch profile",
        error: error.response?.data,
        data: null
      };
    }
  },

  // Update admin profile - actual API integration
  updateProfile: async (profileData) => {
    try {
      const response = await api.get('/api/admin/profile', profileData);

      return {
        success: response.data?.status === "SUCCESS",
        data: response.data?.data,
        message: response.data?.message || "Profile updated successfully"
      };
    } catch (error) {
      console.error("Update profile API error:", error);

      // For network errors, simulate successful update for development
      if (error.code === 'ERR_NETWORK' || !error.response) {
        console.warn("Backend server not responding, simulating profile update");

        return {
          success: true,
          data: profileData,
          message: "Profile updated (simulated - backend not responding)"
        };
      }

      return {
        success: false,
        message: error.response?.data?.message || "Failed to update profile",
        error: error.response?.data
      };
    }
  },

};

// ==================== USER MANAGEMENT ====================
export const userAPI = {
  getUsers: async (payload) => {
    try {
      const response = await api.post(
        '/api/users/get-user-list',
        payload
      );

      return {
        success: response.data?.status === "SUCCESS",
        data: response.data?.data,
        message: response.data?.message
      };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || "Failed to fetch users",
        error: error.response?.data
      };
    }
  },


  // Create new user
  createUser: async (userData) => {
    try {
      const response = await api.post('/api/users', userData);
      return {
        success: response.data?.status === "SUCCESS",
        data: response.data?.data,
        message: response.data?.message
      };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || "Failed to create user",
        error: error.response?.data
      };
    }
  },

  // Update user
  updateUser: async (userId, userData) => {
    try {
      const response = await api.put(`/api/users/${userId}`, userData);
      return {
        success: response.data?.status === "SUCCESS",
        data: response.data?.data,
        message: response.data?.message
      };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || "Failed to update user",
        error: error.response?.data
      };
    }
  },



  // Get user by ID
  getUserById: async (userId) => {
    try {
      const response = await api.get(`/api/users/${userId}`);
      return {
        success: response.data?.status === "SUCCESS",
        data: response.data?.data,
        message: response.data?.message
      };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || "Failed to fetch user",
        error: error.response?.data
      };
    }
  },
  changeUserStatus: async (userId) => {
    try {
      const response = await api.post('/api/users/change-user-status', {
        userId
      });

      return {
        success: response.data?.status === "SUCCESS",
        data: response.data?.data,
        message: response.data?.message
      };
    } catch (error) {
      console.error("Change status API error:", error);
      return {
        success: false,
        message: error.response?.data?.message || "Failed to change user status",
        error: error.response?.data
      };
    }
  },
  deleteUsers: async (userIds) => {
    try {
      const response = await api.post("/api/users/delete-user", {
        userIds
      });

      return {
        success: response.data?.status === "SUCCESS",
        data: response.data?.data,
        message: response.data?.message
      };
    } catch (error) {
      return {
        success: false,
        message:
          error.response?.data?.message || "Failed to delete users",
        error: error.response?.data
      };
    }
  }


};

// ==================== Admin panel USER MANAGEMENT ====================
export const adminPanelUsersAPI = {
  getAdminPanelUsers: async (payload) => {
    try {
      const response = await api.post(
        '/api/admin/admin-panel-user-list',
        payload
      );

      return {
        success: response.data?.status === "SUCCESS",
        data: response.data?.data,
        message: response.data?.message
      };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || "Failed to fetch users",
        error: error.response?.data
      };
    }
  },


  // Create new user
  createAdminPanelUser: async (userData) => {
    try {
      const response = await api.post('/api/admin/create-admin-panel-user', userData);
      return {
        success: response.data?.status === "SUCCESS",
        data: response.data?.data,
        message: response.data?.message
      };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || "Failed to create user",
        error: error.response?.data
      };
    }
  },

  // Update user
  updateAdminPanelUser: async (userId, userData) => {
    try {
      const response = await api.post(`/api/admin/update-admin-panel-user`,
        {
          userId: String(userId),
          ...userData
        });
      return {
        success: response.data?.status === "SUCCESS",
        data: response.data?.data,
        message: response.data?.message
      };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || "Failed to update user",
        error: error.response?.data
      };
    }
  },

  // Toggle Admin Users status
  toggleAdminUsersStatus: async (userId, isActive) => {
    try {
      const response = await api.post('/api/admin/status', {
        userId: userId,
        isActive: isActive
      });

      return {
        success: response.data?.status === "SUCCESS",
        data: response.data?.data,
        message: response.data?.message || "User status updated successfully"
      };
    } catch (error) {
      console.error("Toggle user status API error:", error);
      return {
        success: false,
        message: error.response?.data?.message || "Failed to toggle user status",
        error: error.response?.data
      };
    }
  },


  // Get user by ID
  getAdminPanelUserById: async (userId) => {
    try {
      const response = await api.get(`/api/admin/get-admin-by-id/${userId}`);
      return {
        success: response.data?.status === "SUCCESS",
        data: response.data?.data,
        message: response.data?.message
      };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || "Failed to fetch user",
        error: error.response?.data
      };
    }
  },
  // changeUserStatus: async (userId) => {
  //   try {
  //     const response = await api.post('/api/users/change-user-status', {
  //       userId
  //     });

  //     return {
  //       success: response.data?.status === "SUCCESS",
  //       data: response.data?.data,
  //       message: response.data?.message
  //     };
  //   } catch (error) {
  //     console.error("Change status API error:", error);
  //     return {
  //       success: false,
  //       message: error.response?.data?.message || "Failed to change user status",
  //       error: error.response?.data
  //     };
  //   }
  // },
  deleteAdminPanelUser: async ({ userId }) => {
    try {
      const response = await api.post("/api/admin/admin-panel-user-delete", {
        userId
      });

      return {
        success: response.data?.status === "SUCCESS",
        data: response.data?.data,
        message: response.data?.message
      };
    } catch (error) {
      return {
        success: false,
        message:
          error.response?.data?.message || "Failed to delete users",
        error: error.response?.data
      };
    }
  },


};

// ==================== SALON MANAGEMENT ====================
export const salonAPI = {
  getSalons: async (params = {}) => {
    try {

      const queryParams = new URLSearchParams();

      if (params.page && params.page !== 1) queryParams.append('page', params.page.toString());
      if (params.searchString && params.searchString.trim()) queryParams.append('searchString', params.searchString.trim());
      if (params.cityFilter && params.cityFilter !== 'all') queryParams.append('cityFilter', params.cityFilter);
      if (params.statusFilter && params.statusFilter !== 'all') queryParams.append('statusFilter', params.statusFilter);

      const queryString = queryParams.toString();
      const url = queryString ? `/api/salons/get-salon-list?${queryString}` : '/api/salons/get-salon-list';


      let response;
      try {
        response = await api.get(url);
      } catch (getError) {
        response = await api.get('/api/salons/get-salon-list', { ...params });
      }

      if (response.data?.status === "SUCCESS") {
        const salonsData = response.data.data?.salons ||
          response.data.data?.barberShops ||
          response.data.data ||
          [];

        return {
          success: true,
          data: {
            barberShops: Array.isArray(salonsData) ? salonsData : [],
            pagination: response.data.pagination
          },
          message: response.data.message || "Salons fetched successfully"
        };
      } else {
        // API returned error status
        return {
          success: false,
          data: { barberShops: [] },
          message: response.data?.message || "Failed to fetch salons"
        };
      }
    } catch (error) {
      console.error("Salon list API error:", error);
      console.error("Error details:", error.response?.data);

      if (error.response?.status === 401) {
        throw error;
      }

      if (error.code === 'ERR_NETWORK' || !error.response) {
        console.warn("Backend server not responding, using mock data for development");

        return {
          success: true,
          data: {
            barberShops: [
              {
                salonId: "mock-1",
                salonName: "Demo Salon 1",
                ownerName: "John Doe",
                phoneNumber: "9876543210",
                email: "john@demo.com",
                addressLine1: "123 Main Street",
                addressLine2: "Near Central Mall",
                city: "Mumbai",
                state: "Maharashtra",
                pincode: "400001",
                isActive: true,
                isOpen: true,
                ratingAverage: "4.5",
                totalReviews: 25,
                imageUrl: "https://images.unsplash.com/photo-1560066984-138dadb4c035?w=400",
                queueLength: 5,
                totalWaitTime: { minutes: 75, display: "1h 15m" }
              },
              {
                salonId: "mock-2",
                salonName: "Demo Salon 2",
                ownerName: "Jane Smith",
                phoneNumber: "9876543211",
                email: "jane@demo.com",
                addressLine1: "456 Oak Avenue",
                addressLine2: "Opposite City Hospital",
                city: "Delhi",
                state: "Delhi",
                pincode: "110001",
                isActive: true,
                isOpen: false,
                ratingAverage: "4.2",
                totalReviews: 18,
                imageUrl: "https://images.unsplash.com/photo-1559599101-f09722fb4948?w=400",
                queueLength: 0,
                totalWaitTime: { minutes: 0, display: "0h 0m" }
              }
            ],
            pagination: {
              total: 2,
              page: 1,
              limit: 20,
              totalPages: 1
            }
          },
          message: "Mock data loaded (Backend server not responding)"
        };
      }

      return {
        success: false,
        message: error.response?.data?.message || "Failed to fetch salons",
        error: error.response?.data,
        data: { barberShops: [] }
      };
    }
  },

  // Get salon by ID
  getSalonById: async (salonId) => {
    try {
      const response = await api.get(`/api/salons/get-salon-by-id/${salonId}?details=true`);

      return {
        success: response.data?.status === "SUCCESS",
        data: response.data?.data,
        message: response.data?.message || "Salon fetched successfully"
      };
    } catch (error) {
      console.error("Get salon by ID API error:", error);
      return {
        success: false,
        message: error.response?.data?.message || "Failed to fetch salon",
        error: error.response?.data,
        data: null
      };
    }
  },



  getSalonsByAgent: async ({ agentId, searchString = "" }) => {
    try {
      const response = await api.post("/api/salons/get-salon-by-agent", {
        agentId,
        searchString
      });

      return {
        success: response.data?.status === "SUCCESS",
        data: response.data?.data || [],
        message: response.data?.message || "Salons fetched successfully"
      };

    } catch (error) {
      return {
        success: false,
        message:
          error.response?.data?.message || "Failed to fetch salons",
        error: error.response?.data || error.message
      };
    }
  },

  getSalonDetails: async (salonId) => {
    try {

      let response;
      try {
        response = await api.get(`/api/salons/get-salon-by-id/${salonId}?details=true`);
      } catch (detailedError) {
        response = await api.get(`/api/salons/get-salon/${salonId}`);
      }



      const isSuccess = response.data?.status === "SUCCESS";

      let salonData;
      if (response.data?.data && typeof response.data.data === 'object' && !Array.isArray(response.data.data)) {
        salonData = response.data.data;
      } else if (response.data && typeof response.data === 'object' && !Array.isArray(response.data) && response.data.salonId) {
        salonData = response.data;
      } else {
        salonData = response.data?.data || response.data || {};
      }


      if (salonData.services && Array.isArray(salonData.services)) {

      } else {
        const allServices = [
          ...(salonData?.existingServices || []),
          ...(salonData?.newServices || [])
        ];
        salonData.services = allServices;
      }

      return {
        success: isSuccess,
        data: salonData,
        message: response.data?.message || "Salon details fetched successfully",
        fullResponse: response.data
      };
    } catch (error) {
      console.error("Get salon details API error:", error);
      console.error("Error response:", error.response?.data);
      console.error("Error status:", error.response?.status);

      if (error.code === 'ERR_NETWORK' || !error.response) {
        console.warn("Backend server not responding, using mock salon details");

        return {
          success: true,
          data: {
            salonId: "657bc5e7-09a9-46ed-b588-20ac290f3700",
            salonName: "curl wings1",
            ownerName: "",
            phoneNumber: "1172304812",
            email: "curl@gmail.com",
            addressLine1: "Shop 43",
            addressLine2: "Near Watertank",
            city: "Warud",
            state: "Punjab",
            pincode: "400023",
            genderType: "FEMALE",
            imageUrl: "https://example.com/salon.jpg",
            isActive: true,
            isOpen: true,
            ratingAverage: "4.5",
            totalReviews: 25,
            queueLength: 3,
            totalWaitTime: { minutes: 45, display: "45m" },
            businessHours: [{
              scheduleId: "4acf3a40-2b7a-4e35-8ee7-a20094288383",
              openingTime: "06:09:00",
              closingTime: "07:03:00",
              breakStartTime: "13:00:00",
              breakEndTime: "14:00:00",
              holidayDays: ["Sun"]
            }],
            services: [
              {
                serviceId: "158ef1c3-d1e0-4fd8-863a-d3c0a14f31c8",
                serviceNames: "Rajat2",
                durationMinutes: 20,
                price: "10.00",
                description: "no"
              },
              {
                serviceId: "fea7b4fc-d5c1-4fb0-8cb6-c0b3af4ee1aa",
                serviceNames: "Rajat3",
                durationMinutes: 60,
                price: "40.00",
                description: "nothing"
              }
            ]
          },
          message: "Mock salon details loaded (Backend not responding)"
        };
      }

      return {
        success: false,
        message: error.response?.data?.message ||
          error.message ||
          "Failed to fetch salon details",
        error: error.response?.data,
        data: null
      };
    }
  },

  createSalon: async (salonData) => {
    try {


      const response = await api.post('/api/salons/create', salonData);

      return {
        success: response.data?.status === "SUCCESS",
        data: response.data?.data,
        message: response.data?.message || "Salon created successfully"
      };
    } catch (error) {
      console.error("Create salon API error:", error);
      return {
        success: false,
        message: error.response?.data?.message || "Failed to create salon",
        error: error.response?.data
      };
    }
  },

  updateSalon: async (salonId, salonData) => {
    try {


      const requestBody = {
        salonId: salonId,
        ...salonData
      };



      const response = await api.post('/api/salons/admin-update-salon', requestBody);



      const isSuccess = response.data?.status === "SUCCESS";


      return {
        success: isSuccess,
        data: response.data?.data,
        message: response.data?.message || "Salon updated successfully",
        fullResponse: response.data
      };
    } catch (error) {
      console.error("Update salon API error:", error);
      console.error("Error Response:", error.response);
      console.error("Error Status:", error.response?.status);
      console.error("Error Data:", error.response?.data);

      return {
        success: false,
        message: error.response?.data?.message || "Failed to update salon",
        error: error.response?.data
      };
    }
  },

  // Toggle salon status
  toggleSalonStatus: async (salonId, isActive) => {
    try {
      const response = await api.post('/api/salons/status', {
        salonId: salonId,
        isActive: isActive
      });

      return {
        success: response.data?.status === "SUCCESS",
        data: response.data?.data,
        message: response.data?.message || "Salon status updated successfully"
      };
    } catch (error) {
      console.error("Toggle salon status API error:", error);
      return {
        success: false,
        message: error.response?.data?.message || "Failed to toggle salon status",
        error: error.response?.data
      };
    }
  },

  deleteSalon: async (salonId) => {
    // console.log(`/api/salons/${salonId}`)
    try {
      const response = await api.delete(`/api/salons/delete-salon-by-admin/${salonId}`, {
      });

      return {
        success: true,
        message: "Salon deleted successfully ✅",
        data: response.data,
      };
    } catch (error) {
      // console.error("Delete API error:", error);

      return {
        success: false,
        message: error?.response?.data?.message || "Failed to delete salon ❌",
        data: null,
      };
    }
  },

  // Delete a service from a salon
  deleteService: async (serviceId) => {
    try {
      const response = await api.post(`/api/salons/delete-service`, {
        serviceId: serviceId
      });

      return {
        success: response.data?.status === "SUCCESS",
        data: response.data?.data,
        message: response.data?.message || "Service deleted successfully"
      };
    } catch (error) {
      console.error("Delete service API error:", error);
      return {
        success: false,
        message: error.response?.data?.message || "Failed to delete service",
        error: error.response?.data
      };
    }
  },

  // Get filter list for salons
  getFilterList: async () => {
    try {
      const response = await api.get('/api/salons/get-filter-list');

      return {
        success: response.data?.status === "SUCCESS",
        data: response.data?.data || {},
        message: response.data?.message || "Filter list fetched successfully"
      };
    } catch (error) {
      console.error("❌ Salon filter list API Error:", {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        url: error.config?.url
      });

      return {
        success: false,
        data: {},
        message: error.response?.data?.message || "Failed to fetch salon filter list",
        error: error.response?.data
      };
    }
  }
};

// ==================== BOOKING MANAGEMENT ====================

export const bookingAPI = {
  getBookings: async (params = {}) => {
    try {

      const requestBody = {
        page: params.page || 1,
        searchString: params.search || params.searchString || '',
        statusFilter: (params.status && params.status !== 'all') ? params.status : '',
        salonFilter: (params.salonId && params.salonId !== 'all') ? params.salonId : '',
        bookingDate: params.dateFrom ? (params.dateFrom.includes('T') ? params.dateFrom.split('T')[0] : params.dateFrom) : ''
      };

      if (!requestBody.searchString) delete requestBody.searchString;
      if (!requestBody.statusFilter) delete requestBody.statusFilter;
      if (!requestBody.salonFilter) delete requestBody.salonFilter;
      if (!requestBody.bookingDate) delete requestBody.bookingDate;
      const response = await api.post('/api/booking/list', requestBody);
      if (response.data?.status === "SUCCESS") {
        const bookingsData = response.data.data || [];
        const transformedData = Array.isArray(bookingsData) ? bookingsData.map(booking => {
          const transformed = {
            id: booking.bookingId || booking.id,
            userName: booking.userName || booking.user_name || 'N/A',
            salonName: booking.salonName || booking.salon_name || 'N/A',
            salonId: booking.salonId || booking.salon_id || booking.salon?.id || booking.salon?.salonId,
            serviceNames: booking.serviceNames || booking.service_name || 'N/A',
            date: booking.bookingDate || booking.booking_date || booking.date || 'N/A',
            time: booking.bookingTime || booking.booking_time || booking.time || null,
            status: booking.bookingStatus || booking.booking_status || booking.status || 'pending',
            totalAmount: booking.amount || booking.totalAmount || parseFloat(booking.servicePrice || booking.service_price || 0) || 0
          };
          return transformed;
        }) : [];

        return {
          success: true,
          data: transformedData,
          pagination: response.data.pagination || response.data.paginationData || {
            total: bookingsData.length,
            page: params.page || 1,
            limit: params.limit || 20,
            totalPages: Math.ceil(bookingsData.length / (params.limit || 20))
          },
          message: response.data.message || "Bookings fetched successfully"
        };
      } else {
        return {
          success: false,
          data: [],
          message: response.data?.message || "Failed to fetch bookings"
        };
      }
    } catch (error) {
      console.error("❌ API Error:", {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        url: error.config?.url
      });

      // Check for authentication errors
      if (error.response?.status === 401) {
        console.error("Authentication error, redirecting to login");
        localStorage.removeItem("token");
        window.location.href = '/login';
      }

      return {
        success: false,
        data: [],
        message: error.response?.data?.message || "Failed to fetch bookings",
        error: error.response?.data
      };
    }
  },

  getBookingFilterList: async () => {
    try {
      // Use booking list API to get salons for filtering
      const response = await api.post('/api/booking/list', {
        page: 1,
        // No filters to get all salons
      });

      return {
        success: response.data?.status === "SUCCESS",
        data: response.data?.data || [],
        message: response.data?.message || "Filter list fetched successfully"
      };
    } catch (error) {
      console.error("❌ Booking filter list API Error:", {
        message: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        url: error.config?.url
      });

      return {
        success: false,
        data: [],
        message: error.response?.data?.message || "Failed to fetch booking filter list",
        error: error.response?.data
      };
    }
  }



  // getBookingById: async (bookingId) => {
  //   return {
  //     success: false,
  //     message: "Booking endpoint not implemented yet",
  //     data: null
  //   };
  // },

  // createBooking: async (bookingData) => {
  //   return {
  //     success: false,
  //     message: "Booking creation endpoint not implemented yet",
  //     data: null
  //   };
  // },

  // updateBooking: async (bookingId, bookingData) => {
  //   return {
  //     success: false,
  //     message: "Booking update endpoint not implemented yet",
  //     data: null
  //   };
  // },

  // deleteBooking: async (bookingId) => {
  //   return {
  //     success: false,
  //     message: "Booking deletion endpoint not implemented yet",
  //     data: null
  //   };
  // }
};

// ==================== SALON REQUEST MANAGEMENT ====================
export const salonRequestAPI = {
  getSalonRequests: async ({ page = 1, salonNameFilter = "", requestDate = "", searchString = "" }) => {
    try {
      const payload = {
        page,
        salonNameFilter,
        requestDate,
        searchString
      };

      const response = await api.post('/api/salonrequest/get-list', payload);

      return {
        success: response.data?.status === "SUCCESS",
        data: response.data?.data,
        message: response.data?.message
      };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || "Failed to fetch salon requests",
        error: error.response?.data
      };
    }
  },


  deleteSalonRequests: async (requestIds) => {
    try {
      const res = await api.post("/api/salonrequest/delete-request", {
        requestIds
      });

      return {
        success: res.data?.status === "SUCCESS",
        message: res.data?.message
      };
    } catch (err) {
      return {
        success: false,
        message: err.response?.data?.message || "Delete failed"
      };
    }
  },

  uploadImages: async (formData) => {
    try {
      const res = await api.post("/api/upload/upload-image", formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      return res
    } catch (err) {
      return {
        success: false,
        message: err.response?.data?.message || "Delete failed"
      };
    }
  },

  // approveSalonRequest: async (requestId, approvalData) => {
  //   return {
  //     success: false,
  //     message: "Salon request approval endpoint not implemented yet",
  //     data: null
  //   };
  // },

  // rejectSalonRequest: async (requestId, rejectionData) => {
  //   return {
  //     success: false,
  //     message: "Salon request rejection endpoint not implemented yet",
  //     data: null
  //   };
  // }
};

// ==================== SERVICE MANAGEMENT ====================
export const serviceAPI = {
  // Get services for a salon
  getServices: async (salonId) => {
    try {
      const response = await api.get(`/api/services/salon/${salonId}`);

      return {
        success: response.data?.status === "SUCCESS",
        data: response.data?.data || [],
        message: response.data?.message || "Services fetched successfully"
      };
    } catch (error) {
      console.error("Get services API error:", error);
      return {
        success: false,
        message: error.response?.data?.message || "Failed to fetch services",
        error: error.response?.data
      };
    }
  },

  // Create a new service for a salon
  createService: async (salonId, serviceData) => {
    try {
      const response = await api.post(`/api/services/salon/${salonId}`, serviceData);

      return {
        success: response.data?.status === "SUCCESS",
        data: response.data?.data,
        message: response.data?.message || "Service created successfully"
      };
    } catch (error) {
      console.error("Create service API error:", error);
      return {
        success: false,
        message: error.response?.data?.message || "Failed to create service",
        error: error.response?.data
      };
    }
  },

  // Update a service
  updateService: async (serviceId, serviceData) => {
    try {
      const response = await api.put(`/api/services/${serviceId}`, serviceData);

      return {
        success: response.data?.status === "SUCCESS",
        data: response.data?.data,
        message: response.data?.message || "Service updated successfully"
      };
    } catch (error) {
      console.error("Update service API error:", error);
      return {
        success: false,
        message: error.response?.data?.message || "Failed to update service",
        error: error.response?.data
      };
    }
  },

  // Delete a service
  deleteService: async (serviceId) => {
    try {
      const response = await api.delete(`/api/services/${serviceId}`);

      return {
        success: response.data?.status === "SUCCESS",
        data: response.data?.data,
        message: response.data?.message || "Service deleted successfully"
      };
    } catch (error) {
      console.error("Delete service API error:", error);
      return {
        success: false,
        message: error.response?.data?.message || "Failed to delete service",
        error: error.response?.data
      };
    }
  }
};

// ==================== DASHBOARD/STATS ====================
export const dashboardAPI = {
  getStats: async () => {
    return {
      success: true,
      data: {
        totalUsers: 0,
        totalSalons: 0,
        totalBookings: 0,
        totalRevenue: 0
      },
      message: "Dashboard stats endpoint not implemented yet"
    };
  }
};

// ==================== ADVERTISEMENT MANAGEMENT ====================

const getHeaders = () => {
  const token = localStorage.getItem("token");
  return { Authorization: `Bearer ${token}` };
};
export const advertisementService = {
  // Fetch List
  getList: async (page, limit, search) => {
    const payload = { page, limit };
    const q = (typeof search === 'string') ? search.trim() : search;
    if (q !== undefined && q !== null && q !== '') {
      payload.search = q;
      payload.searchString = q;
    }

    const response = await axios.post(
      `${API_BASE_URL}/api/advertisement/get-list`,
      payload,
      { headers: getHeaders() }
    );

    return response.data;
  },

  // Update Advertisement (tries multiple endpoints, sends advertisementId in body)
  updateAd: async (adId, payload) => {
    let lastError = null;

    // 1) POST /api/advertisement/update with advertisementId in body
    try {
      const res = await axios.post(
        `${API_BASE_URL}/api/advertisement/update`,
        { advertisementId: adId, ...payload },
        { headers: getHeaders() }
      );
      return res.data;
    } catch (err) {
      lastError = err;
      console.warn('updateAd: POST /update with body failed', err.response?.status);
    }

    // 2) POST /api/advertisement/update/:id
    try {
      const res = await axios.post(
        `${API_BASE_URL}/api/advertisement/update/${adId}`,
        payload,
        { headers: getHeaders() }
      );
      return res.data;
    } catch (err) {
      lastError = err;
      console.warn('updateAd: POST /update/:id failed', err.response?.status);
    }

    // 3) PUT /api/advertisement/:id
    try {
      const res = await axios.put(`${API_BASE_URL}/api/advertisement/${adId}`, payload, { headers: getHeaders() });
      return res.data;
    } catch (err) {
      console.error('updateAd: all attempts failed', err.response?.status, err.response?.data || err.message);
      throw lastError || err;
    }
  },

  deleteAd: async (id) => {
    let lastError = null;

    // 4) Try POST /api/advertisement/delete with { advertisementId }
    try {
      const res = await axios.post(`${API_BASE_URL}/api/advertisement/delete`, { advertisementId: id }, { headers: getHeaders() });
      return res.data;
    } catch (err) {
      throw lastError || err;
    }
  },

  getMediaSrc: (imageUrl) => {
    if (!imageUrl) return "/placeholder.svg";
    if (imageUrl.startsWith("http")) return imageUrl;

    let path = imageUrl || "";
    // Ensure leading slash
    if (!path.startsWith('/')) path = `/${path}`;

    // If path contains /public prefix, remove it (server serves from root)
    if (path.startsWith('/public')) path = path.replace('/public', '');

    // Some backends return /uploads/... paths; keep those as-is (after ensuring leading slash)
    return `${API_BASE_URL.replace(/\/$/, '')}${path}`;
  }
};



// ====================Notification API ====================


export const notificationAPI = {
  // Send notification
  sendNotification: async (data) => {
    try {
      const response = await api.post('/api/adminNotification/send-notification-by-admin', {
        targetType: data.targetType,
        title: data.title,
        body: data.body,
        data: data.data || "{}"
      });
      return {
        success: response.data?.status === "SUCCESS",
        data: response.data?.data,
        message: response.data?.message
      };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || "Failed to send notification",
        error: error.response?.data
      };
    }
  },

  // Delete notification
  deleteNotification: async (id) => {
    try {
      const response = await api.post('/api/adminNotification/delete-admin-notification', {
        notificationId: id
      });
      return {
        success: response.data?.status === "SUCCESS",
        data: response.data?.data,
        message: response.data?.message
      };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || "Failed to delete notification",
        error: error.response?.data
      };
    }
  },

  // Get notifications (same as before)
  getNotifications: async (page = 1, searchString = "") => {
    try {
      const response = await api.post('/api/adminNotification/get-admin-notification-list', {
        page: page,
        searchString: searchString  
      });
      return {
        success: response.data?.status === "SUCCESS",
        data: response.data?.data,
        message: response.data?.message
      };
    } catch (error) {
      return {
        success: false,
        message: error.response?.data?.message || "Failed to fetch notifications",
        error: error.response?.data
      };
    }
  }
};



export default api;

// ==================== NAAI SHOP (B2B) ====================
// Two product worlds: the salons' customer-facing products (untouched) and
// the company catalog salons BUY from (shop_products below). Orders carry
// two status tracks: `status` = internal (admin/distributor),
// `customerStatus` = what the salon sees. DECIMAL columns come back as
// strings — parse with Number() before display.

// Company catalog (admin product management tab)
export const shopProductAPI = {
  adminList: async ({ page = 1, searchString = "" } = {}) => {
    try {
      const response = await api.post('/api/shop-products/admin-list', { page, searchString });
      return { success: response.data?.status === "SUCCESS", data: response.data?.data, message: response.data?.message };
    } catch (error) {
      return { success: false, message: error.response?.data?.message || "Failed to fetch shop products", error: error.response?.data };
    }
  },
  create: async (productData) => {
    try {
      const response = await api.post('/api/shop-products/admin-create', productData);
      return { success: response.data?.status === "SUCCESS", data: response.data?.data, message: response.data?.message };
    } catch (error) {
      return { success: false, message: error.response?.data?.message || "Failed to create product", error: error.response?.data };
    }
  },
  update: async (productData) => {
    try {
      const response = await api.post('/api/shop-products/admin-update', productData);
      return { success: response.data?.status === "SUCCESS", data: response.data?.data, message: response.data?.message };
    } catch (error) {
      return { success: false, message: error.response?.data?.message || "Failed to update product", error: error.response?.data };
    }
  },
  remove: async (productId) => {
    try {
      const response = await api.post('/api/shop-products/admin-delete', { productId });
      return { success: response.data?.status === "SUCCESS", data: response.data?.data, message: response.data?.message };
    } catch (error) {
      return { success: false, message: error.response?.data?.message || "Failed to delete product", error: error.response?.data };
    }
  }
};

// Delivery partners (distributors tab)
export const distributorAPI = {
  list: async ({ page = 1, searchString = "" } = {}) => {
    try {
      const response = await api.post('/api/distributors/list', { page, searchString });
      return { success: response.data?.status === "SUCCESS", data: response.data?.data, message: response.data?.message };
    } catch (error) {
      return { success: false, message: error.response?.data?.message || "Failed to fetch distributors", error: error.response?.data };
    }
  },
  create: async (distributorData) => {
    try {
      const response = await api.post('/api/distributors/create', distributorData);
      return { success: response.data?.status === "SUCCESS", data: response.data?.data, message: response.data?.message };
    } catch (error) {
      return { success: false, message: error.response?.data?.message || "Failed to create distributor", error: error.response?.data };
    }
  },
  update: async (distributorData) => {
    try {
      const response = await api.post('/api/distributors/update', distributorData);
      return { success: response.data?.status === "SUCCESS", data: response.data?.data, message: response.data?.message };
    } catch (error) {
      return { success: false, message: error.response?.data?.message || "Failed to update distributor", error: error.response?.data };
    }
  },
  // Distributor portal login (phone or email + the password the admin set).
  login: async ({ identifier, password }) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/api/distributors/login`, { identifier, password });
      return { success: response.data?.status === "SUCCESS", data: response.data?.data, message: response.data?.message };
    } catch (error) {
      return { success: false, message: error.response?.data?.message || "Login failed", error: error.response?.data };
    }
  }
};

// Orders — admin dashboard + distributor portal
export const shopOrderAPI = {
  adminList: async ({ page = 1, status = "", customerStatus = "", searchString = "" } = {}) => {
    try {
      const response = await api.post('/api/shop-orders/admin-list', { page, status, customerStatus, searchString });
      return { success: response.data?.status === "SUCCESS", data: response.data?.data, message: response.data?.message };
    } catch (error) {
      return { success: false, message: error.response?.data?.message || "Failed to fetch orders", error: error.response?.data };
    }
  },
  adminGetById: async (orderId) => {
    try {
      const response = await api.post('/api/shop-orders/admin-get-by-id', { orderId });
      return { success: response.data?.status === "SUCCESS", data: response.data?.data, message: response.data?.message };
    } catch (error) {
      return { success: false, message: error.response?.data?.message || "Failed to fetch order", error: error.response?.data };
    }
  },
  assignDistributor: async ({ orderId, distributorId, notes = "" }) => {
    try {
      const response = await api.post('/api/shop-orders/admin-assign-distributor', { orderId, distributorId, notes });
      return { success: response.data?.status === "SUCCESS", data: response.data?.data, message: response.data?.message };
    } catch (error) {
      return { success: false, message: error.response?.data?.message || "Failed to assign distributor", error: error.response?.data };
    }
  },
  updateStatus: async ({ orderId, status, notes = "" }) => {
    try {
      const response = await api.post('/api/shop-orders/admin-update-status', { orderId, status, notes });
      return { success: response.data?.status === "SUCCESS", data: response.data?.data, message: response.data?.message };
    } catch (error) {
      return { success: false, message: error.response?.data?.message || "Failed to update status", error: error.response?.data };
    }
  },
  // Distributor portal (distributor token, or the admin's token when the
  // admin records a decision taken over the phone)
  distributorOrders: async ({ page = 1, status = "" } = {}) => {
    try {
      const response = await api.post('/api/shop-orders/distributor-orders', { page, status });
      return { success: response.data?.status === "SUCCESS", data: response.data?.data, message: response.data?.message };
    } catch (error) {
      return { success: false, message: error.response?.data?.message || "Failed to fetch orders", error: error.response?.data };
    }
  },
  accept: async (orderId) => {
    try {
      const response = await api.post('/api/shop-orders/distributor-accept', { orderId });
      return { success: response.data?.status === "SUCCESS", data: response.data?.data, message: response.data?.message };
    } catch (error) {
      return { success: false, message: error.response?.data?.message || "Failed to accept order", error: error.response?.data };
    }
  },
  reject: async ({ orderId, reason }) => {
    try {
      const response = await api.post('/api/shop-orders/distributor-reject', { orderId, reason });
      return { success: response.data?.status === "SUCCESS", data: response.data?.data, message: response.data?.message };
    } catch (error) {
      return { success: false, message: error.response?.data?.message || "Failed to reject order", error: error.response?.data };
    }
  },
  // Distributor carries an accepted parcel forward (next step only — the
  // server enforces ASSIGNED -> PICKED -> SHIPPED -> DELIVERED). The admin
  // token is accepted too, for moves recorded over the phone.
  distributorUpdateStatus: async ({ orderId, status }) => {
    try {
      const response = await api.post('/api/shop-orders/distributor-update-status', { orderId, status });
      return { success: response.data?.status === "SUCCESS", data: response.data?.data, message: response.data?.message };
    } catch (error) {
      return { success: false, message: error.response?.data?.message || "Failed to update order status", error: error.response?.data };
    }
  }
};

// Shop Settings — the admin-managed commerce rules (free-delivery threshold,
// delivery charges, order discount %, COD limit + COD charges). One row on
// the backend; the web shop bills from it.
export const shopSettingsAPI = {
  get: async () => {
    try {
      const response = await api.post('/api/shop-settings/get', {});
      return { success: response.data?.status === "SUCCESS", data: response.data?.data, message: response.data?.message };
    } catch (error) {
      return { success: false, message: error.response?.data?.message || "Failed to load shop settings", error: error.response?.data };
    }
  },
  update: async (settingsData) => {
    try {
      const response = await api.post('/api/shop-settings/admin-update', settingsData);
      return { success: response.data?.status === "SUCCESS", data: response.data?.data, message: response.data?.message };
    } catch (error) {
      return { success: false, message: error.response?.data?.message || "Failed to save shop settings", error: error.response?.data };
    }
  }
};