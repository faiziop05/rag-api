import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

// Async thunk to fetch documents
export const fetchDocuments = createAsyncThunk(
  'documents/fetchDocuments',
  async (_, { getState, rejectWithValue }) => {
    try {
      const { auth } = getState();
      const response = await fetch('http://localhost:3000/documents', {
        headers: {
          'Authorization': `Bearer ${auth.token}`
        }
      });
      if (!response.ok) throw new Error('Failed to fetch documents');
      return await response.json();
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

// Async thunk to upload a document
export const uploadDocument = createAsyncThunk(
  'documents/uploadDocument',
  async ({ file, knowledgeBaseId, mode }, { getState, rejectWithValue }) => {
    try {
      const { auth } = getState();
      const formData = new FormData();
      formData.append('file', file);
      formData.append('knowledge_base_id', knowledgeBaseId);
      // Without this the backend always falls back to its own auto-detect
      // mode — the UI's "Standard vs Deep Vision" choice was silently
      // dropped here and never reached the API at all.
      if (mode) formData.append('processing_mode', mode);

      const response = await fetch('http://localhost:3000/ingest', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${auth.token}`
        },
        body: formData
      });
      
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Upload failed');
      }
      return await response.json();
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

// Async thunk to delete a document
export const deleteDocument = createAsyncThunk(
  'documents/deleteDocument',
  async (kbId, { getState, rejectWithValue }) => {
    try {
      const { auth } = getState();
      const response = await fetch(`http://localhost:3000/documents/${kbId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${auth.token}`
        }
      });
      if (!response.ok) throw new Error('Failed to delete document');
      return kbId;
    } catch (error) {
      return rejectWithValue(error.message);
    }
  }
);

const initialState = {
  items: [],
  isLoading: false,
  error: null,
  uploading: false,
  uploadError: null,
};

const documentsSlice = createSlice({
  name: 'documents',
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    // Fetch
    builder.addCase(fetchDocuments.pending, (state) => {
      state.isLoading = true;
      state.error = null;
    });
    builder.addCase(fetchDocuments.fulfilled, (state, action) => {
      state.isLoading = false;
      state.items = action.payload;
    });
    builder.addCase(fetchDocuments.rejected, (state, action) => {
      state.isLoading = false;
      state.error = action.payload;
    });
    
    // Upload
    builder.addCase(uploadDocument.pending, (state) => {
      state.uploading = true;
      state.uploadError = null;
    });
    builder.addCase(uploadDocument.fulfilled, (state, action) => {
      state.uploading = false;
      // Note: Ingestion is async (BullMQ), but we can optimistically add a placeholder
      state.items.push({
        id: action.payload.knowledge_base_id,
        filename: action.payload.knowledge_base_id, // we might not have actual filename here easily
        status: 'processing'
      });
    });
    builder.addCase(uploadDocument.rejected, (state, action) => {
      state.uploading = false;
      state.uploadError = action.payload;
    });

    // Delete
    builder.addCase(deleteDocument.fulfilled, (state, action) => {
      state.items = state.items.filter(doc => doc.id !== action.payload);
    });
  },
});

export default documentsSlice.reducer;
