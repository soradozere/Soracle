"use client"

import type React from "react"

import { useState, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Upload } from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { uploadCSV } from "@/app/admin/actions"

interface CSVUploadProps {
  onUploadComplete: () => void
}

export function CSVUpload({ onUploadComplete }: CSVUploadProps) {
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { toast } = useToast()

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setIsUploading(true)

    try {
      const formData = new FormData()
      formData.append("file", file)

      const result = await uploadCSV(formData)

      if (result.success) {
        toast({
          title: "Success",
          description: `Imported ${result.count} players from CSV`,
        })
        onUploadComplete()
      } else {
        toast({
          title: "Error",
          description: result.error,
          variant: "destructive",
        })
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to upload CSV",
        variant: "destructive",
      })
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    }
  }

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        onChange={handleFileChange}
        className="hidden"
        id="csv-upload"
      />
      <Button onClick={() => fileInputRef.current?.click()} disabled={isUploading} variant="outline">
        <Upload className="h-4 w-4 mr-2" />
        {isUploading ? "Uploading..." : "Upload CSV"}
      </Button>
    </div>
  )
}
