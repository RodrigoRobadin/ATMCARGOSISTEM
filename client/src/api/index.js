// client/src/api/index.js
import axios from 'axios';

const base = import.meta.env.VITE_API_URL || '/api';

export const api = {
  get:  (url, cfg) => axios.get(`${base}${url}`, cfg),
  post: (url, data, cfg) => axios.post(`${base}${url}`, data, cfg),
  put:  (url, data, cfg) => axios.put(`${base}${url}`, data, cfg),

  // Operaciones
  getOperation: (id) => api.get(`/operations/${id}`),
  putAir:       (id, data) => api.put(`/operations/${id}/air`, data),
  putOcean:     (id, data) => api.put(`/operations/${id}/ocean`, data),
  putRoad:      (id, data) => api.put(`/operations/${id}/road`, data),
  putMultimodal:(id, data) => api.put(`/operations/${id}/multimodal`, data),
};
