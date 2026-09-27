import React from 'react';
import { useResume } from '../../../contexts/ResumeContext';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Button } from '../../ui/button';
import { Upload, X } from 'lucide-react';

export const PersonalInfoForm: React.FC = () => {
  const { state, updatePersonalInfo } = useResume();
  const { personalInfo } = state.resumeData;

  const handleInputChange = (field: keyof typeof personalInfo, value: string) => {
    updatePersonalInfo({ [field]: value });
  };

  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        updatePersonalInfo({ profileImage: result });
      };
      reader.readAsDataURL(file);
    }
  };

  const removeImage = () => {
    updatePersonalInfo({ profileImage: '' });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Personal Information
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">Full Name *</Label>
            <Input
              id="fullName"
              name="fullName"
              autoComplete="name"
              placeholder="John Doe"
              value={personalInfo.fullName}
              onChange={(e) => handleInputChange('fullName', e.target.value)}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="jobTitle">Job Title *</Label>
            <Input
              id="jobTitle"
              name="jobTitle"
              autoComplete="organization-title"
              placeholder="Software Engineer"
              value={personalInfo.jobTitle}
              onChange={(e) => handleInputChange('jobTitle', e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="birthDate">Birth Date (Optional)</Label>
            <Input
              id="birthDate"
              name="birthDate"
              autoComplete="bday"
              placeholder="February 11th, 1996"
              value={personalInfo.birthDate || ''}
              onChange={(e) => handleInputChange('birthDate', e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="location">Location *</Label>
            <Input
              id="location"
              name="location"
              autoComplete="address-level2"
              placeholder="New York, NY"
              value={personalInfo.location}
              onChange={(e) => handleInputChange('location', e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email *</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="john@example.com"
              value={personalInfo.email}
              onChange={(e) => handleInputChange('email', e.target.value)}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="phone">Phone *</Label>
            <Input
              id="phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              placeholder="+1 (555) 123-4567"
              value={personalInfo.phone}
              onChange={(e) => handleInputChange('phone', e.target.value)}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="website">Website</Label>
            <Input
              id="website"
              name="website"
              type="url"
              autoComplete="url"
              placeholder="https://yourwebsite.com"
              value={personalInfo.website}
              onChange={(e) => handleInputChange('website', e.target.value)}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="linkedin">LinkedIn</Label>
            <Input
              id="linkedin"
              name="linkedin"
              type="url"
              autoComplete="url"
              placeholder="https://linkedin.com/in/username"
              value={personalInfo.linkedin}
              onChange={(e) => handleInputChange('linkedin', e.target.value)}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="github">GitHub</Label>
            <Input
              id="github"
              name="github"
              type="url"
              autoComplete="url"
              placeholder="https://github.com/username"
              value={personalInfo.github}
              onChange={(e) => handleInputChange('github', e.target.value)}
            />
          </div>
        </div>

        {/* Profile Image Upload */}
        <div className="space-y-2">
          <Label>Profile Picture (Optional)</Label>
          <div className="flex items-center gap-4">
            {personalInfo.profileImage ? (
              <div className="relative">
                <img
                  src={personalInfo.profileImage}
                  alt="Profile"
                  className="w-16 h-16 rounded-full object-cover border-2 border-border"
                />
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-full p-0"
                  onClick={removeImage}
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            ) : (
              <div className="w-16 h-16 rounded-full border-2 border-dashed border-border flex items-center justify-center">
                <Upload className="w-6 h-6 text-muted-foreground" />
              </div>
            )}
            
            <div>
              <input
                type="file"
                accept="image/*"
                name="profileImage"
                aria-label="Profile picture"
                onChange={handleImageUpload}
                className="hidden"
                id="profile-image"
              />
              <Label htmlFor="profile-image" className="cursor-pointer">
                <Button type="button" variant="outline" size="sm" asChild>
                  <span>Choose Image</span>
                </Button>
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                Recommended: Square image, max 2MB
              </p>
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground">* Required fields</p>
      </CardContent>
    </Card>
  );
};